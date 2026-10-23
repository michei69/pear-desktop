// The equalizer's serial insert in the shared audio graph. One stage owns:
// input → 11 bands → parallel extra filters → wet/dry bypass mix → output trim.
// Parameters are changed in place with a short target ramp, so dragging a
// slider or toggling bypass never clicks or rebuilds the graph.

import type { AudioGraph, Logger, Unsubscribe } from "@pear/sdk";
import { clamp } from "@pear/sdk/util";
import { isFilterType, MAX_FREQUENCY, MIN_FREQUENCY, normalizeBand, type Band, type EqualizerState } from "./config.ts";

/** After analysis taps, before the compressor (and the fades/output). */
const ORDER = 10;
/** Time constant of a parameter ramp; long enough to hide a jump, short enough to feel live. */
const SMOOTHING_S = 0.01;

const dbToLinear = (db: number) => 10 ** (db / 20);

type ExtraFilter = Band;

/** `cancelAndHoldAtTime` is newer than some DOM typings; feature-detect it anyway. */
type HoldableAudioParam = AudioParam & { cancelAndHoldAtTime?: (time: number) => AudioParam };

const finiteOr = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** pear-desktop's `filters` option: biquads mixed in parallel with the bands. */
function parseExtraFilters(json: string, log: Logger): ExtraFilter[] {
  if (!json.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) throw new Error("expected an array");
    const filters: ExtraFilter[] = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;
      const entry = item as Record<string, unknown>;
      const type = entry.type;
      const frequency = entry.frequency;
      if (!isFilterType(type) || typeof frequency !== "number" || !Number.isFinite(frequency)) continue;
      filters.push({
        type,
        frequency: Math.max(0, frequency),
        Q: Math.max(0.0001, finiteOr(entry.Q, 1)),
        gain: finiteOr(entry.gain, 0),
      });
    }
    return filters;
  } catch (error) {
    log.warn("ignoring invalid extra filters", error);
    return [];
  }
}

export class EqualizerChain {
  readonly #context: AudioContext;
  readonly #input: GainNode;
  readonly #dry: GainNode;
  readonly #wet: GainNode;
  readonly #output: GainNode;
  readonly #bands: BiquadFilterNode[];
  #extras: BiquadFilterNode[] = [];
  #extrasJson = "";
  readonly #remove: Unsubscribe;
  readonly #graphSource: MediaElementAudioSourceNode;
  readonly #graphVideo: HTMLVideoElement;
  #video: HTMLVideoElement;
  #rebound: MediaElementAudioSourceNode | undefined;
  #disposed = false;

  constructor(graph: AudioGraph) {
    this.#context = graph.context;
    this.#graphSource = graph.source;
    this.#graphVideo = graph.video;
    this.#video = graph.video;
    const context = this.#context;
    this.#input = context.createGain();
    this.#dry = context.createGain();
    this.#wet = context.createGain();
    this.#output = context.createGain();
    this.#dry.gain.value = 0;
    this.#wet.gain.value = 1;
    this.#bands = Array.from({ length: 11 }, (_, index) => {
      const filter = context.createBiquadFilter();
      const band = normalizeBand(undefined, index);
      filter.type = band.type;
      filter.frequency.value = band.frequency;
      filter.Q.value = band.Q;
      filter.gain.value = band.gain;
      return filter;
    });

    let previous: AudioNode = this.#input;
    for (const band of this.#bands) {
      previous.connect(band);
      previous = band;
    }
    previous.connect(this.#wet);
    this.#input.connect(this.#dry);
    this.#dry.connect(this.#output);
    this.#wet.connect(this.#output);

    this.#remove = graph.insert(this.#input, this.#output, ORDER);
  }

  /** Applies the live state; only a changed extra-filters list rebuilds nodes. */
  apply(state: EqualizerState, extraFiltersJson: string, log: Logger) {
    if (this.#disposed) return;
    const now = this.#context.currentTime;
    const maxFrequency = Math.min(MAX_FREQUENCY, Math.max(MIN_FREQUENCY, this.#context.sampleRate / 2 - 1));
    const smooth = (param: AudioParam, value: number) => {
      const hold = (param as HoldableAudioParam).cancelAndHoldAtTime;
      if (hold) hold.call(param, now);
      param.setTargetAtTime(value, now, SMOOTHING_S);
    };

    state.bands.forEach((value, index) => {
      const filter = this.#bands[index];
      if (!filter) return;
      const band = normalizeBand(value, index);
      filter.type = band.type;
      smooth(filter.frequency, clamp(band.frequency, MIN_FREQUENCY, maxFrequency));
      smooth(filter.Q, band.Q);
      // The fork flattens the bands while bypassed; the dry/wet path also keeps
      // non-gain filter types and the extra filters from coloring the sound.
      smooth(filter.gain, state.bypass ? 0 : band.gain);
    });

    smooth(this.#output.gain, dbToLinear(state.outputGainDb));
    smooth(this.#dry.gain, state.bypass ? 1 : 0);
    smooth(this.#wet.gain, state.bypass ? 0 : 1);

    if (this.#extrasJson !== extraFiltersJson) {
      this.#extrasJson = extraFiltersJson;
      this.#rewireExtras(parseExtraFilters(extraFiltersJson, log));
    }
  }

  /**
   * YT Music swaps the `<video>` element on some seeks; the shared graph keeps
   * the old element's source. Feed the new element into this stage as well, so
   * the equalizer keeps processing instead of dropping to the raw output. The
   * compressor does the same for its later stage.
   */
  rebind(video: HTMLVideoElement) {
    if (this.#disposed || video === this.#video) return;
    if (video === this.#graphVideo) {
      // Back to the element the shared graph owns; its source still exists.
      this.#rebound?.disconnect();
      this.#rebound = undefined;
      try {
        this.#graphSource.disconnect(this.#input);
      } catch {
        // Not connected.
      }
      this.#graphSource.connect(this.#input);
      this.#video = video;
      return;
    }
    try {
      const source = this.#context.createMediaElementSource(video);
      this.#rebound?.disconnect();
      this.#rebound = source;
      source.connect(this.#input);
      try {
        this.#graphSource.disconnect(this.#input);
      } catch {
        // The graph's source was not connected to this stage.
      }
      this.#video = video;
    } catch {
      // The graph already bound this element, or it can no longer be bound.
    }
  }

  /** The bands feed both the next band and every extra filter, as pear-desktop mixed them. */
  #rewireExtras(filters: readonly ExtraFilter[]) {
    for (const node of this.#extras) {
      try {
        node.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    const last = this.#bands[this.#bands.length - 1];
    if (!last) return;
    try {
      last.disconnect();
    } catch {
      // Already disconnected.
    }
    last.connect(this.#wet);
    this.#extras = filters.map((filter) => {
      const node = this.#context.createBiquadFilter();
      node.type = filter.type;
      node.frequency.value = Math.max(0, filter.frequency);
      node.Q.value = Math.max(0.0001, filter.Q);
      node.gain.value = filter.gain;
      last.connect(node);
      node.connect(this.#wet);
      return node;
    });
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#remove();
    this.#rebound?.disconnect();
    this.#rebound = undefined;
    for (const node of [this.#input, this.#dry, this.#wet, this.#output, ...this.#bands, ...this.#extras]) {
      try {
        node.disconnect();
      } catch {
        // The shared graph may have disconnected it already.
      }
    }
    this.#extras = [];
  }
}
