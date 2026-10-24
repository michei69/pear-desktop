// The second stream: the current track's own audio, played silently in step with
// the video and handed over when the track ends, so its tail can fade out under
// the next track. Keeping it on the video's clock from the start is what makes
// the handover a splice instead of a switch: the two copies are the same signal.

import type { AudioGraph } from "@pear/sdk";
import { fadeCurve } from "./fade.ts";
import type { Ctx } from "./schema.ts";

/** Attempts a track's audio is fetched for before falling back to its stream URL. */
const AUDIO_FETCH_ATTEMPTS = 3;
/** Delay between audio fetch attempts, in milliseconds. */
const AUDIO_FETCH_RETRY_MS = 500;

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

/** Where a track's audio came from: its bytes, or its stream URL as a fallback. */
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
  audio: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  objectUrl: string | undefined;
  /** Between `play()` and the `playing` event that measures what the start cost. */
  starting: boolean;
  /** Released or failed: never played again. */
  gone: boolean;
  alignment: ReturnType<typeof setInterval> | undefined;
  fade: Fade | undefined;
}

export function secondStream(ctx: Ctx, graph: AudioGraph) {
  const { context, video } = graph;
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

  /** The level of the video's own output: the crossfade's stream has to match it. */
  const volumeNow = () => {
    if (ctx.player.state.muted) return 0;
    const getter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume")?.get;
    const volume = getter ? (getter.call(video) as number) : video.volume;
    return video.muted ? 0 : volume;
  };

  const isStalled = (element: HTMLMediaElement) =>
    element.paused || element.seeking || element.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;

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
    gain.connect(context.destination);

    const stream: Stream = {
      videoId,
      audio,
      source: node,
      gain,
      objectUrl,
      starting: false,
      gone: false,
      alignment: undefined,
      fade: undefined,
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

  const fetchAudio = async (videoId: string, stale: () => boolean): Promise<Source | undefined> => {
    for (let attempt = 1; attempt <= AUDIO_FETCH_ATTEMPTS; attempt += 1) {
      if (stale() || ctx.signal.aborted) return undefined;
      try {
        const bytes = await ctx.host.invoke("audioBytes", videoId);
        if (bytes?.bytes.byteLength) return { kind: "bytes", bytes: bytes.bytes, mimeType: bytes.mimeType };
      } catch (error) {
        ctx.log.warn(`the audio of ${videoId} didn't arrive (attempt ${attempt}/${AUDIO_FETCH_ATTEMPTS})`, error);
      }
      if (attempt < AUDIO_FETCH_ATTEMPTS) {
        const delay = Promise.withResolvers<void>();
        ctx.setTimeout(() => delay.resolve(), AUDIO_FETCH_RETRY_MS);
        await delay.promise;
      }
    }

    // The bytes didn't arrive: fall back to the track's own stream URL, which the
    // element can still play silently with the video.
    if (stale() || ctx.signal.aborted) return undefined;
    try {
      return { kind: "url", url: await ctx.host.invoke("audioUrl", videoId) };
    } catch (error) {
      ctx.log.warn(`no second stream for ${videoId}; the track plays without a crossfade`, error);
      return undefined;
    }
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

  const resumeOutgoing = () => {
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

  const pause = () => {
    if (current) {
      current.starting = false;
      current.audio.pause();
    }
    pauseOutgoing();
  };

  // The stream is the same track as the video, so it plays at the video's level.
  // The player's volume is its slider's (before YTM's perceptual curve), so the
  // element's own level is read instead.
  ctx.player.on("volumeChange", () => {
    const level = volumeNow();
    if (current) current.audio.volume = level;
    if (outgoing) outgoing.audio.volume = level;
  });

  // The silent copy follows the video's own clock: stopped while it is parked or
  // seeking, started again on the clock when it runs, and re-anchored by `follow`
  // after a seek the alignment would only chase.
  ctx.listen(video, "playing", () => {
    follow();
    resumeOutgoing();
  });
  ctx.listen(video, "pause", pause);
  ctx.listen(video, "seeking", () => {
    if (current) {
      current.starting = false;
      current.audio.pause();
    }
  });
  ctx.listen(video, "seeked", follow);
  ctx.listen(video, "waiting", () => {
    if (current) {
      current.starting = false;
      current.audio.pause();
    }
  });
  ctx.listen(video, "ratechange", () => {
    // Match the new base rate right away; the alignment then closes any drift it left.
    if (current && !current.audio.paused) current.audio.playbackRate = video.playbackRate;
    follow();
    if (outgoing) outgoing.audio.playbackRate = video.playbackRate;
  });

  return {
    /** Fetches the stream of the track that just started. */
    prepare(videoId: string) {
      if (current?.videoId === videoId || pendingVideoId === videoId) return;
      if (current) {
        const stream = current;
        current = null;
        dispose(stream);
      }

      const fetch = ++generation;
      pendingVideoId = videoId;
      void fetchAudio(videoId, () => fetch !== generation)
        .then((source) => {
          if (fetch !== generation) return;
          pendingVideoId = undefined;
          if (!source || ctx.signal.aborted) return;
          const stream = create(videoId, source);
          current = stream;
          stream.alignment = ctx.setInterval(() => align(stream), ALIGN_INTERVAL_MS);
          follow();
        })
        .catch((error: unknown) => {
          if (fetch === generation) pendingVideoId = undefined;
          ctx.log.warn(`no second stream for ${videoId}`, error);
        });
    },

    /** The current track's audio is loaded and running silently with the video. */
    ready() {
      const stream = current;
      return (
        !!stream &&
        !stream.gone &&
        stream.videoId === ctx.player.state.track?.videoId &&
        !stream.audio.paused &&
        stream.audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
      );
    },

    /**
     * Hands the track over to its own audio: both copies play for the splice, then
     * the stream fades out over `fadeSeconds`. False when there is no stream to
     * hand over to, so the caller fades the video instead.
     */
    handover(fadeSeconds: number): boolean {
      const stream = current;
      if (!stream || stream.gone || stream.starting || fadeSeconds <= 0) return false;
      if (stream.videoId !== ctx.player.state.track?.videoId) return false;
      if (stream.audio.paused || stream.audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return false;

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
      const stream = outgoing;
      if (!stream) return;
      outgoing = null;
      dispose(stream);
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
      const streams = [current, outgoing];
      current = null;
      outgoing = null;
      for (const stream of streams) if (stream) dispose(stream);
    },
  };
}
