// The second stream: the current track's own audio, played silently in step with
// the video and handed over when the track ends, so its tail can fade out under
// the next track. Buffered bytes are already there, so they are kept on the
// video's clock from the start, which makes the handover a splice instead of a
// switch: the two copies are the same signal. A stream URL only needs its last
// seconds, so it is fetched when the track nears its end instead.

import type { AudioGraph, Unsubscribe, YTPlayerApi } from "@pear/sdk";
import { listenAll } from "@pear/sdk/dom";
import { fadeCurve } from "./fade.ts";
import type { Ctx } from "./schema.ts";

/** Attempts a track's audio is fetched for before falling back to its stream URL. */
const AUDIO_FETCH_ATTEMPTS = 3;
/** Delay between audio fetch attempts, in milliseconds. */
const AUDIO_FETCH_RETRY_MS = 500;
/** Seconds before the fade window opens that a track's stream URL is fetched. */
const URL_WARMUP_LEAD_SECONDS = 30;
/**
 * Audio a URL stream must have buffered ahead before it takes the track over, in
 * seconds: enough headroom that ordinary jitter cannot stall the fade, which
 * runs on the audio clock. Bytes are already all there.
 */
const HANDOVER_BUFFER_SECONDS = 2;
/** A pause this short is the site switching tracks, not the user stopping. */
const OUTGOING_PAUSE_GRACE_MS = 300;

// How close the silent audio has to sit on the video's clock before it is left
// alone, in seconds. Two copies offset by that much cancel the half period of the
// offset, so it is held as tightly as the two clocks can be read.
const ALIGNED_WITHIN = 0.0005;
/** Seconds a drift is closed over, once the audio runs at its own rate. */
const ALIGN_WINDOW = 0.1;
/** How far the alignment may take the playback rate from the video's. */
const ALIGN_RATE_LIMIT = 0.5;
/** The slowest rate a media element accepts. */
const MIN_PLAYBACK_RATE = 0.0625;
// Drift past this is not a start that ran long but the audio at another position
// entirely, from a seek that got past the transport listeners: move it rather
// than run it back.
const REANCHOR_ABOVE = 0.1;
/** Longest the audio may be started ahead of the video, in seconds. */
const MAX_START_LEAD = 0.5;
/** Milliseconds between alignment checks. */
const ALIGN_INTERVAL_MS = 50;

/** Seconds the outgoing track takes to move from the video's audio into its own. */
export const HANDOVER_SECONDS = 0.02;
/** Freed a moment after the fade's last sample, so the curve is not cut short. */
const RELEASE_SLACK_MS = 100;
/** exponential-volume's volume accessor was installed or restored (see its index.ts). */
const VOLUME_MAP_EVENT = "pear:volume-map";

/** Where a track's audio came from: buffered bytes, or a stream URL the browser plays directly. */
type Source = { kind: "bytes"; bytes: Uint8Array; mimeType: string } | { kind: "url"; url: string };

interface Fade {
  /** Context time the fade-out curve starts, after the handover. */
  startedAt: number;
  duration: number;
  /** Seconds of the curve that ran before a pause. */
  elapsed: number;
  paused: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
}

interface Stream {
  videoId: string;
  /** Buffered bytes, or a stream URL: a URL stream is only as good as its buffer. */
  kind: Source["kind"];
  audio: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  /** Removes the gain from the shared graph's externals. */
  external: Unsubscribe;
  objectUrl: string | undefined;
  /** Between `play()` and the `playing` event that measures what the start cost. */
  starting: boolean;
  /** Released or failed: never played again. */
  gone: boolean;
  alignment: ReturnType<typeof setInterval> | undefined;
  fade: Fade | undefined;
  /** Reason the last handover was refused, so retries log each state once. */
  refusal: string | undefined;
}

/**
 * The player is on the video's original audio track. The second stream can only
 * be fetched for that one: InnerTube's formats are chosen by the host without an
 * audio-track parameter (the library filters a language only for the adaptive
 * audio-only branch, ignores it for the muxed fallback, and a miss would silently
 * serve any track). A dub or a picked language must therefore fall back to the
 * plain fade, never be spliced in as the wrong one.
 */
export function isOriginalAudioTrack(api: YTPlayerApi | null | undefined) {
  try {
    // One track is no choice: nothing can be selected, so it is the original.
    if ((api?.getAvailableAudioTracks?.() ?? []).length < 2) return true;
    const track = api?.getAudioTrack?.();
    if (!track) return true;
    const info = track.getLanguageInfo?.();
    const raw = track as { Pb?: { isDefault?: boolean; isAutoDubbed?: boolean } };
    const isDefault = info?.getIsDefault?.() ?? raw.Pb?.isDefault ?? false;
    const autoDubbed = info?.getIsAutoDubbed?.() ?? raw.Pb?.isAutoDubbed ?? false;
    return isDefault && !autoDubbed;
  } catch {
    // A player without the selector plays its only track.
    return true;
  }
}

export function secondStream(ctx: Ctx, graph: AudioGraph) {
  const { context } = graph;
  // YTM may replace the <video>; the stream follows the live element.
  let video = graph.video;
  /** The track just loaded, playing silently alongside the video. */
  let current: Stream | null = null;
  /** The previous track, heard while it fades out after a handover. */
  let outgoing: Stream | null = null;
  /** Drops a fetch that a newer navigation made stale. */
  let generation = 0;
  /** The track whose audio is being fetched, so its listener pair doesn't fetch twice. */
  let pendingVideoId: string | undefined;
  /**
   * Seconds a media element takes to run after it is told to play, as last
   * measured: the audio starts that much ahead of the video to end up level with it.
   */
  let startLead = 0;
  /** A track whose tail comes from its stream URL, fetched near the end. */
  let tail: { videoId: string; generation: number } | null = null;
  /** A pause of the outgoing fade waiting out the site's own track switch. */
  let outgoingPause: ReturnType<typeof setTimeout> | undefined;

  /** The level of the video's own output: the crossfade's stream has to match it. */
  const volumeNow = () => {
    if (ctx.player.state.muted) return 0;
    const getter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume")?.get;
    const volume = getter ? (getter.call(video) as number) : video.volume;
    return video.muted ? 0 : volume;
  };

  const isStalled = (element: HTMLMediaElement) =>
    element.paused || element.seeking || element.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;

  /** Seconds of the stream buffered ahead of its playhead. */
  const bufferedAhead = (audio: HTMLMediaElement) => {
    const { buffered, currentTime } = audio;
    for (let index = 0; index < buffered.length; index += 1) {
      if (buffered.start(index) <= currentTime && currentTime < buffered.end(index)) return buffered.end(index) - currentTime;
    }
    return 0;
  };

  /** Seconds the outgoing tail plays under the incoming track. */
  const fadeOutSeconds = () => ctx.config.fadeOutDuration / 1000;

  /**
   * Whether the stream can take the track over now. Bytes always can; a URL
   * stream needs enough buffered ahead that its fade cannot stall.
   */
  const canHandOver = (stream: Stream) => {
    const { audio } = stream;
    if (stream.starting || audio.paused || audio.seeking || audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return false;
    return stream.kind === "bytes" || bufferedAhead(audio) >= HANDOVER_BUFFER_SECONDS;
  };

  /** Why a stream can't take the track over, for the log that explains a plain fade. */
  const handoverRefusal = (stream: Stream) => {
    const { audio } = stream;
    if (stream.starting) return "still starting";
    if (audio.paused) return "paused";
    if (audio.seeking) return "seeking";
    if (audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return `readyState ${audio.readyState}`;
    return `only ${bufferedAhead(audio).toFixed(1)}s buffered`;
  };

  const stopAlignment = (stream: Stream) => {
    if (stream.alignment !== undefined) ctx.clearInterval(stream.alignment);
    stream.alignment = undefined;
  };

  const dispose = (stream: Stream) => {
    if (stream.gone) return;
    stream.gone = true;
    stopAlignment(stream);
    const fade = stream.fade;
    if (fade && fade.timer !== undefined) ctx.clearTimeout(fade.timer);
    stream.fade = undefined;
    stream.audio.onplaying = null;
    stream.audio.onerror = null;
    stream.audio.pause();
    stream.audio.removeAttribute("src");
    stream.audio.load();
    // Out of the graph first, then the nodes' own edges.
    stream.external();
    stream.gain.disconnect();
    stream.source.disconnect();
    if (stream.objectUrl) URL.revokeObjectURL(stream.objectUrl);
  };

  /** Starts the audio on the video's clock from where it stands. */
  const start = (stream: Stream) => {
    const { audio } = stream;
    // The position is handed over only while the element is stopped: seeking a
    // playing element costs time it comes back behind by, and an earlier one is
    // one the video has moved past. The last measured lead carries the start's cost.
    audio.pause();
    audio.playbackRate = video.playbackRate;
    const lead = video.playbackRate === 1 ? startLead : 0;
    audio.currentTime = Math.max(0, video.currentTime + lead);
    stream.starting = true;
    void audio.play().catch((error: unknown) => {
      if (stream.gone) return;
      stream.starting = false;
      ctx.log.warn("the second stream didn't play", error);
    });
  };

  /** Runs the silent audio with the video: stopped while its clock is parked. */
  const follow = () => {
    const stream = current;
    if (!stream || stream.gone) return;
    if (ctx.player.state.ad || isStalled(video)) {
      stream.starting = false;
      stream.audio.pause();
      return;
    }
    if (stream.audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA || stream.audio.seeking) return;
    if (!stream.audio.paused) return;
    start(stream);
  };

  const align = (stream: Stream) => {
    if (stream !== current || stream.gone || stream.starting || ctx.player.state.ad) return;
    if (isStalled(video)) return;
    if (stream.audio.paused) {
      // Stopped from under the loop (the browser paused it, or the element ended
      // early): put it back on the video's clock.
      follow();
      return;
    }
    if (stream.audio.seeking || stream.audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;

    const base = video.playbackRate;
    const drift = video.currentTime - stream.audio.currentTime;

    if (Math.abs(drift) < ALIGNED_WITHIN) {
      if (stream.audio.playbackRate !== base) stream.audio.playbackRate = base;
      return;
    }

    // Too far out for any start of this audio to have left it there: start it
    // again rather than run it back.
    if (Math.abs(drift) > REANCHOR_ABOVE) {
      start(stream);
      return;
    }

    // Rate that closes the drift over the next `ALIGN_WINDOW` seconds: behind its
    // clock it plays faster to catch up, ahead of it slower to let the video pass.
    const lowest = Math.max(MIN_PLAYBACK_RATE, base - ALIGN_RATE_LIMIT);
    const rate = Math.min(Math.max(base + drift / ALIGN_WINDOW, lowest), base + ALIGN_RATE_LIMIT);
    if (stream.audio.playbackRate !== rate) stream.audio.playbackRate = rate;
  };

  const create = (videoId: string, audioSource: Source) => {
    const audio = new Audio();
    audio.preload = "auto";
    audio.volume = volumeNow();
    audio.playbackRate = video.playbackRate;

    let objectUrl: string | undefined;
    if (audioSource.kind === "bytes") {
      objectUrl = URL.createObjectURL(new Blob([new Uint8Array(audioSource.bytes)], { type: audioSource.mimeType }));
      audio.src = objectUrl;
    } else {
      // Bytes travel around the site's CORS and container limits, and the URL
      // fallback needs the origin's permission to reach the shared graph.
      audio.crossOrigin = "anonymous";
      audio.src = audioSource.url;
    }

    const node = context.createMediaElementSource(audio);
    const gain = context.createGain();
    gain.gain.value = 0;
    node.connect(gain);
    // In the shared graph, injected after the pre-chain stages (crossfade's own
    // fader, skip-silences) and before the equalizer and compressor, so the
    // effects process the fade tail; the visualizer's tap sees it too. Removed
    // from the graph on dispose.
    const external = graph.connectExternal(gain, 0);

    const stream: Stream = {
      videoId,
      kind: audioSource.kind,
      audio,
      source: node,
      gain,
      external,
      objectUrl,
      starting: false,
      gone: false,
      alignment: undefined,
      fade: undefined,
      refusal: undefined,
    };

    // Measures what starting the audio costs the clock, for the next start to
    // carry: the element was handed a position `startLead` ahead, so the measured
    // offset is the cost of the start. Only measured at the normal rate.
    audio.onplaying = () => {
      if (stream.gone || stream !== current || !stream.starting) return;
      stream.starting = false;
      if (video.playbackRate !== 1) return;
      const lead = video.currentTime - audio.currentTime + startLead;
      if (lead >= 0 && lead <= MAX_START_LEAD) startLead = lead;
    };

    audio.onerror = () => {
      if (stream.gone) return;
      ctx.log.warn(`the second stream of ${videoId} failed to load`);
      if (current === stream) current = null;
      if (outgoing === stream) outgoing = null;
      dispose(stream);
    };

    return stream;
  };

  const install = (videoId: string, source: Source) => {
    const stream = create(videoId, source);
    current = stream;
    stream.alignment = ctx.setInterval(() => align(stream), ALIGN_INTERVAL_MS);
    follow();
    if (source.kind === "url") ctx.log.info(`the tail of ${videoId} is streaming ${video.currentTime.toFixed(1)}s in`);
  };

  /** The track's bytes, or none when they can't be buffered (too long, refused, URL-only mode). */
  const fetchBytes = async (videoId: string, stale: () => boolean): Promise<Source | undefined> => {
    if (ctx.config.streamUrlOnly) return undefined;
    for (let attempt = 1; attempt <= AUDIO_FETCH_ATTEMPTS; attempt += 1) {
      if (stale() || ctx.signal.aborted) return undefined;
      try {
        const bytes = await ctx.host.invoke("audioBytes", videoId);
        // No bytes at all means the host declined to buffer this track (too long,
        // or over the byte budget). Don't retry a refusal: the tail streams instead.
        if (bytes === undefined) return undefined;
        if (bytes.bytes.byteLength) return { kind: "bytes", bytes: bytes.bytes, mimeType: bytes.mimeType };
      } catch (error) {
        ctx.log.warn(`the audio of ${videoId} didn't arrive (attempt ${attempt}/${AUDIO_FETCH_ATTEMPTS})`, error);
      }
      if (attempt < AUDIO_FETCH_ATTEMPTS) {
        const delay = Promise.withResolvers<void>();
        ctx.setTimeout(() => delay.resolve(), AUDIO_FETCH_RETRY_MS);
        await delay.promise;
      }
    }
    return undefined;
  };

  /** The track's stream URL, minted when the track is near its end. */
  const fetchUrl = async (videoId: string, stale: () => boolean): Promise<Source | undefined> => {
    try {
      const url = await ctx.host.invoke("audioUrl", videoId);
      if (stale() || ctx.signal.aborted) return undefined;
      ctx.log.info(`using the stream URL for ${videoId}${ctx.config.streamUrlOnly ? " (URL-only mode)" : ""}`);
      return { kind: "url", url };
    } catch (error) {
      ctx.log.warn(`no second stream for ${videoId}; the track plays without a crossfade`, error);
      return undefined;
    }
  };

  /** The track is close enough to its end for its tail to be worth streaming. */
  const nearEnd = () => {
    const duration = video.duration;
    if (!Number.isFinite(duration)) return false;
    return video.currentTime >= duration - ctx.config.secondsBeforeEnd - fadeOutSeconds() - URL_WARMUP_LEAD_SECONDS;
  };

  /**
   * Fetches a URL source's tail once the track is near its end, so the element
   * only streams the last seconds and one URL need not stay valid for the whole
   * track. Bytes are fetched when the track loads instead.
   */
  const preload = () => {
    const plan = tail;
    if (!plan || !nearEnd()) return;
    tail = null;
    const fetch = plan.generation;
    void fetchUrl(plan.videoId, () => fetch !== generation)
      .then((source) => {
        if (fetch !== generation) return;
        if (!source || ctx.signal.aborted || !isOriginalAudioTrack(ctx.player.api)) return;
        install(plan.videoId, source);
      })
      .catch((error: unknown) => ctx.log.warn(`no second stream for ${plan.videoId}`, error));
  };

  const scheduleRelease = (stream: Stream, seconds: number) => {
    const fade = stream.fade;
    if (!fade) return;
    if (fade.timer !== undefined) ctx.clearTimeout(fade.timer);
    fade.timer = ctx.setTimeout(
      () => {
        if (outgoing === stream) outgoing = null;
        dispose(stream);
      },
      Math.max(0, seconds) * 1000 + RELEASE_SLACK_MS,
    );
  };

  const pauseOutgoing = () => {
    const stream = outgoing;
    const fade = stream?.fade;
    if (!stream || !fade || fade.paused) return;
    stream.audio.pause();
    fade.elapsed = Math.min(fade.duration, Math.max(0, context.currentTime - fade.startedAt));
    fade.paused = true;
    if (fade.timer !== undefined) {
      ctx.clearTimeout(fade.timer);
      fade.timer = undefined;
    }
    stream.gain.gain.cancelAndHoldAtTime(context.currentTime);
  };

  const cancelOutgoingPause = () => {
    if (outgoingPause !== undefined) {
      ctx.clearTimeout(outgoingPause);
      outgoingPause = undefined;
    }
  };

  // The site loads the next track through the same <video>, which pauses it for a
  // moment. The outgoing tail has to outlive that pause; a real one still stops it.
  const pauseOutgoingSoon = () => {
    if (!outgoing?.fade || outgoingPause !== undefined) return;
    outgoingPause = ctx.setTimeout(() => {
      outgoingPause = undefined;
      pauseOutgoing();
    }, OUTGOING_PAUSE_GRACE_MS);
  };

  const resumeOutgoing = () => {
    cancelOutgoingPause();
    const stream = outgoing;
    const fade = stream?.fade;
    if (!stream || !fade || !fade.paused) return;

    const remaining = Math.max(0, fade.duration - fade.elapsed);
    const now = context.currentTime;
    if (remaining <= 0 || fade.duration <= 0) {
      stream.gain.gain.setValueAtTime(0, now);
      outgoing = null;
      dispose(stream);
      return;
    }

    fade.paused = false;
    stream.gain.gain.setValueCurveAtTime(fadeCurve(ctx, "out", fade.elapsed / fade.duration, 1), now, remaining);
    fade.startedAt = now;
    scheduleRelease(stream, remaining);
    void stream.audio.play().catch((error: unknown) => {
      if (!stream.gone) ctx.log.warn("the outgoing stream didn't resume", error);
    });
  };

  const pauseCurrent = () => {
    if (!current) return;
    current.starting = false;
    current.audio.pause();
  };

  const pause = () => {
    pauseCurrent();
    pauseOutgoingSoon();
  };

  // The stream is the same track as the video, so it plays at the video's level.
  // The player's volume is its slider's (before YTM's perceptual curve), so the
  // element's own level is read instead.
  const syncVolume = () => {
    const level = volumeNow();
    if (current) current.audio.volume = level;
    if (outgoing) outgoing.audio.volume = level;
  };
  ctx.player.on("volumeChange", syncVolume);
  // The elements are detached, so exponential-volume's re-map of the document's
  // media misses them; it announces its accessor change and they re-read the
  // video's level through it (removed with the plugin's listeners).
  ctx.listen(document, VOLUME_MAP_EVENT, syncVolume);

  // The silent copy follows the video's own clock: stopped while it is parked or
  // seeking, started again on the clock when it runs, and re-anchored by `follow`
  // after a seek the alignment would only chase.
  let unbindVideo: (() => void) | undefined;
  const bindVideo = (next: HTMLVideoElement) => {
    unbindVideo?.();
    video = next;
    unbindVideo = listenAll(video, {
      playing: () => {
        follow();
        resumeOutgoing();
      },
      pause,
      seeking: pauseCurrent,
      seeked: follow,
      waiting: pauseCurrent,
      ratechange: () => {
        // Match the new base rate right away; the alignment then closes any drift it left.
        if (current && !current.audio.paused) current.audio.playbackRate = video.playbackRate;
        follow();
        if (outgoing) outgoing.audio.playbackRate = video.playbackRate;
      },
    });
  };
  bindVideo(video);
  ctx.onCleanup(() => unbindVideo?.());

  return {
    /** Fetches the stream of the track that just started. */
    prepare(videoId: string) {
      if (current?.videoId === videoId || pendingVideoId === videoId || tail?.videoId === videoId) return;
      if (current) {
        const stream = current;
        current = null;
        dispose(stream);
      }
      tail = null;

      const fetch = ++generation;
      pendingVideoId = videoId;
      // A dub or a picked language would hand over to the original track's audio;
      // those tracks keep the fallback fade instead. Checked again when the fetch
      // resolves and before the handover, because audio-track applies after load.
      if (!isOriginalAudioTrack(ctx.player.api)) {
        pendingVideoId = undefined;
        ctx.log.info(`no second stream for ${videoId}: its audio track isn't the original`);
        return;
      }
      void fetchBytes(videoId, () => fetch !== generation)
        .then((source) => {
          if (fetch !== generation) return;
          pendingVideoId = undefined;
          if (ctx.signal.aborted || !isOriginalAudioTrack(ctx.player.api)) return;
          if (source) {
            install(videoId, source);
            return;
          }
          // Only the last seconds are needed: fetch the URL when the track gets
          // near its end, so the element never streams the whole thing.
          tail = { videoId, generation: fetch };
          preload();
        })
        .catch((error: unknown) => {
          if (fetch === generation) pendingVideoId = undefined;
          ctx.log.warn(`no second stream for ${videoId}`, error);
        });
    },

    /** Fetches a URL source's tail once the track is near its end. */
    preload,

    /** The current track's audio is loaded and running silently with the video. */
    ready() {
      const stream = current;
      return (
        isOriginalAudioTrack(ctx.player.api) &&
        !!stream &&
        !stream.gone &&
        stream.videoId === ctx.player.state.track?.videoId &&
        canHandOver(stream)
      );
    },

    /**
     * Hands the track over to its own audio: both copies play for the splice, then
     * the stream fades out over `fadeSeconds`. False when there is no stream to
     * hand over to, so the caller fades the video instead.
     */
    handover(fadeSeconds: number): boolean {
      const stream = current;
      if (!stream || stream.gone || fadeSeconds <= 0) return false;
      // The fetched copy is the original track; another one must not be spliced in.
      if (!isOriginalAudioTrack(ctx.player.api)) return false;
      if (stream.videoId !== ctx.player.state.track?.videoId) return false;
      if (!canHandOver(stream)) {
        const reason = handoverRefusal(stream);
        if (stream.refusal !== reason) {
          stream.refusal = reason;
          ctx.log.info(`the tail of ${stream.videoId} can't take over yet: ${reason}`);
        }
        return false;
      }
      stream.refusal = undefined;

      stopAlignment(stream);
      stream.audio.playbackRate = video.playbackRate;

      const now = context.currentTime;
      const gain = stream.gain.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(0, now);
      gain.linearRampToValueAtTime(1, now + HANDOVER_SECONDS);
      gain.setValueCurveAtTime(fadeCurve(ctx, "out"), now + HANDOVER_SECONDS, fadeSeconds);

      stream.fade = { startedAt: now + HANDOVER_SECONDS, duration: fadeSeconds, elapsed: 0, paused: false, timer: undefined };
      scheduleRelease(stream, HANDOVER_SECONDS + fadeSeconds);
      outgoing = stream;
      current = null;
      return true;
    },

    /** Drops an outgoing fade, for a skip or a navigation that interrupts it. */
    cancelTransition() {
      cancelOutgoingPause();
      const stream = outgoing;
      if (!stream) return;
      outgoing = null;
      dispose(stream);
    },

    /** Follows a <video> YTM swapped. */
    rebind(next: HTMLVideoElement) {
      bindVideo(next);
    },
    /** Stops both streams, for a pause or an ad. */
    pause,
    /** Runs them again, with the outgoing fade where it was left. */
    resume() {
      follow();
      resumeOutgoing();
    },
    /** Starts the silent stream once the video runs again, without touching a fade. */
    follow,
    /** Frees every node, element and timer the module holds. */
    release() {
      generation += 1;
      pendingVideoId = undefined;
      tail = null;
      cancelOutgoingPause();
      const streams = [current, outgoing];
      current = null;
      outgoing = null;
      for (const stream of streams) if (stream) dispose(stream);
    },
  };
}
