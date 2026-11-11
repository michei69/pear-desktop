// The shared Web Audio graph. A media element can only ever have one
// MediaElementAudioSourceNode, so plugins (equalizer, compressor, visualizer…)
// insert stages into this single chain instead of creating their own. The page
// runtime owns the one graph per media element (captureAudioGraph): it captures
// it early when a sampling plugin is enabled and re-cuts it when YTM swaps the
// <video>.

import type { AudioGraph as AudioGraphApi, Unsubscribe } from "@pear/sdk";
import { ensureCORSMedia } from "./media.ts";

interface Stage {
  input: AudioNode;
  output: AudioNode;
  order: number;
  seq: number;
}

export class AudioGraph implements AudioGraphApi {
  readonly context: AudioContext;
  #source: MediaElementAudioSourceNode;
  #video: HTMLVideoElement;
  /** Elements whose autoplay resume is already wired; YTM reuses the element. */
  #watched = new WeakSet<HTMLVideoElement>();
  #stages: Stage[] = [];
  #taps = new Set<AudioNode>();
  #seq = 0;

  constructor(video: HTMLVideoElement) {
    this.#video = video;
    this.context = new AudioContext({ latencyHint: "playback" });
    // Before the source node exists: Web Audio silences cross-origin media
    // that was not fetched in CORS mode (podcast/RSS audio).
    ensureCORSMedia(video);
    this.#source = this.context.createMediaElementSource(video);
    this.#watchPlayback(video);
    this.#rewire();
  }

  get source() {
    return this.#source;
  }

  get video() {
    return this.#video;
  }

  /**
   * YT Music swaps the `<video>` element on some seeks; the source node stays
   * bound to the retired one, so re-cut the whole chain to the live element.
   * Returns the new source, or null when nothing changed.
   */
  rebind(video: HTMLVideoElement): MediaElementAudioSourceNode | null {
    if (video === this.#video) return null;
    ensureCORSMedia(video);
    let source: MediaElementAudioSourceNode;
    try {
      source = this.context.createMediaElementSource(video);
    } catch {
      // The element is already bound elsewhere (an older plugin workaround).
      return null;
    }
    const previous = this.#source;
    this.#source = source;
    this.#video = video;
    safeDisconnect(previous);
    this.#watchPlayback(video);
    this.#rewire();
    return source;
  }

  insert(input: AudioNode, output: AudioNode = input, order = 0): Unsubscribe {
    const stage = { input, output, order, seq: this.#seq++ };
    this.#stages.push(stage);
    this.#rewire();
    return () => {
      this.#stages = this.#stages.filter((s) => s !== stage);
      safeDisconnect(stage.output);
      this.#rewire();
    };
  }

  tap(node: AudioNode): Unsubscribe {
    this.#taps.add(node);
    this.#rewire();
    return () => {
      this.#taps.delete(node);
      this.#rewire();
    };
  }

  #watchPlayback(video: HTMLVideoElement) {
    if (this.#watched.has(video)) return;
    this.#watched.add(video);
    // Autoplay policy may create the context suspended; playback resumes it.
    video.addEventListener("playing", () => void this.context.resume());
    if (!video.paused) void this.context.resume();
  }

  #rewire() {
    safeDisconnect(this.#source);
    for (const stage of this.#stages) safeDisconnect(stage.output);
    const ordered = [...this.#stages].sort((a, b) => a.order - b.order || a.seq - b.seq);
    let last: AudioNode = this.#source;
    for (const stage of ordered) {
      last.connect(stage.input);
      last = stage.output;
    }
    last.connect(this.context.destination);
    for (const tap of this.#taps) last.connect(tap);
  }
}

let captured: AudioGraph | undefined;

/**
 * The page's one graph. Boot captures it early when a sampling plugin is
 * enabled, because a `createMediaElementSource` on an element whose MSE
 * pipeline is already running freezes playback at its current position; a
 * plugin enabled later captures it on its first `ctx.audio()`. Callers pass
 * YTM's live <video> (not a stale `videoReady()` result); plugins insert
 * stages through the graph instead of constructing their own.
 */
export function captureAudioGraph(video: HTMLVideoElement): AudioGraph {
  captured ??= new AudioGraph(video);
  captured.rebind(video);
  return captured;
}

/** Re-cuts the graph if it exists; YTM swapped the <video> and consumers must follow. */
export function rebindAudioGraph(video: HTMLVideoElement) {
  captured?.rebind(video);
}

function safeDisconnect(node: AudioNode) {
  try {
    node.disconnect();
  } catch {
    // Not connected.
  }
}
