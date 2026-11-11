// The crossfade's wiring: when to hand the track over to its own audio, click to
// the next one, and fade it in. Without a second stream (its audio didn't arrive,
// or wasn't playable), the track fades out before the next one fades in.

import { type PoTokenRequest, poTokens } from "@pear/sdk/potoken";
import { createFader } from "./fade.ts";
import type { Ctx } from "./schema.ts";
import { HANDOVER_SECONDS, secondStream } from "./stream.ts";

// Tracks shorter than this play untouched.
const MIN_TRACK_SECONDS = 30;
/** How long an auto-transition may stay armed without a navigation: the
 * next-track control may do nothing (no next button, end of queue), and the
 * flag must not turn the user's next manual skip into a crossfade. */
const AUTO_TRANSITION_TIMEOUT_MS = 5000;
/** Short ramp back to full level after a next-track click that didn't navigate. */
const RESTORE_SECONDS = 0.05;

interface FadeIn {
  startedAt: number;
  /** Seconds that ran before a pause. */
  elapsed: number;
  duration: number;
  paused: boolean;
}

export async function startCrossfade(ctx: Ctx) {
  // The host's InnerTube session asks the page for PO tokens: BotGuard needs a
  // real DOM, so it mints here, as it does for the downloader.
  const tokens = poTokens();
  ctx.host.handle("poToken", (request) => tokens.answer(request as PoTokenRequest));
  ctx.onCleanup(() => tokens.dispose());

  const graph = await ctx.audio();
  const { context } = graph;
  // YTM may replace the <video> on a seek; always work on the live element.
  let video = graph.video;
  const fader = createFader(ctx, graph);
  const stream = secondStream(ctx, graph);

  /** The fallback fade-out (no second stream) is under way. */
  let fadingOut = false;
  /** The next track was already asked for; `timeupdate` must not ask again. */
  let skipped = false;
  /** The incoming track has loaded but has not started, so its fade waits for `playing`. */
  let pendingFadeIn = false;
  /** The next track is loading because this track handed over, not because the user skipped. */
  let autoTransition = false;
  /** Clears `autoTransition` if no navigation consumes it in time. */
  let autoTransitionTimer: ReturnType<typeof setTimeout> | undefined;
  /** A fade-in of the incoming track, so a pause can freeze and resume it. */
  let fadingIn: FadeIn | null = null;
  /** Context time the handover splice of the outgoing track runs until. */
  let handoverUntil = 0;

  /** Seconds of a fade-in that have run, including the part before a pause. */
  const fadeInElapsed = (fade: FadeIn) =>
    Math.min(fade.duration, fade.elapsed + (fade.paused ? 0 : Math.max(0, context.currentTime - fade.startedAt)));
  /** Forgets a fade-in that has run its length. */
  const pruneFadeIn = () => {
    if (fadingIn && fadeInElapsed(fadingIn) >= fadingIn.duration) fadingIn = null;
  };

  const fadeWindow = () => {
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration < MIN_TRACK_SECONDS || ctx.player.state.ad) return;
    const end = Math.max(0, duration - ctx.config.secondsBeforeEnd);
    const length = Math.min(ctx.config.fadeOutDuration / 1000, end);
    return { start: end - length, end, length };
  };

  // The fallback: with no second stream to hand over to, the video's own audio
  // fades out over the rest of the fade window.
  const scheduleFadeOut = () => {
    const fade = fadeWindow();
    if (!fade || video.paused || stream.ready()) return;
    const position = video.currentTime;
    if (position < fade.start || position >= fade.end) return;
    fadingOut = true;
    const from = fade.length > 0 ? (fade.end - position) / fade.length : 0;
    fader.ramp(from, 0, (fade.end - position) / video.playbackRate);
  };

  const startFadeIn = () => {
    pendingFadeIn = false;
    fadingOut = false;
    const duration = ctx.config.fadeInDuration / 1000 / video.playbackRate;
    if (duration <= 0) {
      fadingIn = null;
      fader.hold(1);
      return;
    }
    // Not before the outgoing track's splice has finished: the ramp down of the
    // video's audio is part of that handover.
    const start = Math.max(context.currentTime, handoverUntil);
    fadingIn = { startedAt: start, elapsed: 0, duration, paused: false };
    fader.ramp(0, 1, duration, start);
  };

  // Pauses freeze the fade at the level it had reached; a rate change or a seek
  // resumes it from there, over what is left of its length.
  const freezeFadeIn = () => {
    if (!fadingIn || fadingIn.paused) return;
    fadingIn.elapsed = fadeInElapsed(fadingIn);
    fadingIn.paused = true;
    fader.freeze();
  };

  const resumeFadeIn = () => {
    if (!fadingIn) return;
    const elapsed = fadeInElapsed(fadingIn);
    const remaining = Math.max(0, fadingIn.duration - elapsed);
    if (remaining <= 0) {
      fadingIn = null;
      fader.hold(1);
      return;
    }
    fadingIn.elapsed = elapsed;
    fadingIn.startedAt = context.currentTime;
    fadingIn.paused = false;
    fader.ramp(elapsed / fadingIn.duration, 1, remaining);
  };

  /**
   * Releases an armed auto-transition. Only a navigation to another track
   * consumes it, so every other way out has to clear it: a teardown, or the
   * click that never navigated.
   */
  const clearAutoTransition = () => {
    autoTransition = false;
    if (autoTransitionTimer !== undefined) {
      ctx.clearTimeout(autoTransitionTimer);
      autoTransitionTimer = undefined;
    }
  };

  /**
   * The armed transition never navigated (last item of a queue, no next
   * button): give the still-playing track its audio back. `skipped` stays set,
   * so the same track does not ask for a next one again; a real navigation
   * resets it.
   */
  const restoreAfterFailedTransition = () => {
    stream.cancelTransition();
    fader.splice(1, RESTORE_SECONDS);
    handoverUntil = 0;
    pendingFadeIn = false;
    fadingIn = null;
    fadingOut = false;
    clearAutoTransition();
  };

  const skip = () => {
    skipped = true;
    fadingOut = false;
    if (ctx.player.state.repeat === "one") {
      // The same track starts over: there is no next track to overlap, so only
      // the fade-in runs (the silent copy follows the seek).
      ctx.player.control({ type: "seek", seconds: 0 });
      startFadeIn();
      return;
    }
    // The track's own audio is already running silently with the video, so the
    // handover is a splice: both copies play for a moment while the audio moves
    // from the video into the stream. The stream then fades its tail out under
    // the next track.
    if (stream.handover(ctx.config.fadeOutDuration / 1000)) {
      fader.splice(0, HANDOVER_SECONDS);
      handoverUntil = context.currentTime + HANDOVER_SECONDS;
    } else {
      fader.hold(0);
      handoverUntil = 0;
    }
    // Bounded: a click that does not navigate (no next button, end of queue)
    // must not stay armed for the next track, and must not leave this one silent.
    clearAutoTransition();
    autoTransition = true;
    autoTransitionTimer = ctx.setTimeout(restoreAfterFailedTransition, AUTO_TRANSITION_TIMEOUT_MS);
    pendingFadeIn = true;
    fadingIn = null;
    ctx.player.control({ type: "next" });
  };

  const onTime = () => {
    const fade = fadeWindow();
    if (!fade || video.paused) return;
    pruneFadeIn();
    const position = video.currentTime;
    if (position >= fade.end) {
      if (!skipped) skip();
      return;
    }
    // Its audio arrived after the fallback fade began: bring the video back up so
    // the handover has both copies at full level.
    if (fadingOut && stream.ready()) {
      fader.splice(1, 0.05);
      fadingOut = false;
    }
    if (!fadingOut && !fadingIn && !skipped && position >= fade.start && !stream.ready()) {
      scheduleFadeOut();
    }
  };

  const resync = () => {
    if (ctx.player.state.ad || pendingFadeIn) return;
    pruneFadeIn();
    if (video.paused) {
      freezeFadeIn();
      fader.freeze();
      return;
    }

    const fade = fadeWindow();
    if (!fade || video.currentTime < fade.start) {
      // Seeked back out of a fade-out; a fade-in in progress is left alone.
      skipped = false;
      fadingOut = false;
      if (fadingIn) resumeFadeIn();
      else if (!stream.ready()) fader.hold(1);
      return;
    }

    if (fadingIn) {
      resumeFadeIn();
      return;
    }

    if (stream.ready()) {
      // The video is not faded before the handover: both copies have to be at full
      // level for the splice to be clickless.
      fader.hold(1);
      fadingOut = false;
      return;
    }
    // A next-track click already failed for this track: leave its restored level
    // alone instead of fading the tail out again.
    if (skipped) return;
    scheduleFadeOut();
  };

  ctx.player.on("trackLoading", (videoId) => {
    // A manual skip, a previous, or a navigation interrupts an outgoing fade; the
    // automatic transition is the one that leaves its outgoing track playing. Its
    // splice has already taken the video down, so it must not be cut short here.
    if (!autoTransition) {
      stream.cancelTransition();
      fader.hold(0);
    }
    clearAutoTransition();
    skipped = false;
    fadingOut = false;
    pendingFadeIn = true;
    fadingIn = null;
    stream.prepare(videoId);
  });

  ctx.player.on("trackChange", (track) => {
    // A navigation that arrives without `trackLoading` consumes the latch too;
    // otherwise its timeout would restore over the incoming track's fade-in.
    clearAutoTransition();
    stream.prepare(track.videoId);
  });
  const initialTrack = ctx.player.state.track;
  if (initialTrack) stream.prepare(initialTrack.videoId);

  const onVideoPlaying = () => {
    if (pendingFadeIn && !ctx.player.state.ad) startFadeIn();
    else resync();
  };
  let unbindVideo: (() => void)[] = [];
  const bindVideo = (next: HTMLVideoElement) => {
    for (const off of unbindVideo) off();
    video = next;
    stream.rebind(next);
    const target = video;
    const listen = (type: string, listener: EventListener) => {
      target.addEventListener(type, listener);
      return () => target.removeEventListener(type, listener);
    };
    unbindVideo = [
      listen("playing", onVideoPlaying),
      listen("timeupdate", onTime),
      listen("pause", resync),
      listen("seeked", resync),
      listen("ratechange", resync),
    ];
    if (!video.paused) resync();
  };
  bindVideo(video);
  ctx.player.on("videoChange", bindVideo);
  ctx.onCleanup(() => {
    for (const off of unbindVideo) off();
  });

  ctx.player.on("adChange", (ad) => {
    if (ad) {
      // Ads play at full volume and are not the track: the outgoing tail and the
      // silent copy stop, and the crossfade starts again after the ad.
      stream.cancelTransition();
      stream.pause();
      fader.hold(1);
      return;
    }
    if (pendingFadeIn && !video.paused) startFadeIn();
    else if (pendingFadeIn) fader.hold(0);
    else {
      stream.follow();
      resync();
    }
  });

  // Every option is read when used; re-schedule a fade in progress.
  ctx.onConfigChange(resync);
  ctx.onCleanup(() => {
    clearAutoTransition();
    stream.release();
  });
}
