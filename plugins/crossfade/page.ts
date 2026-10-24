// The crossfade's wiring: when to hand the track over to its own audio, click to
// the next one, and fade it in. Without a second stream (its audio didn't arrive,
// or wasn't playable), the track fades out before the next one fades in.

import { createFader } from "./fade.ts";
import type { Ctx } from "./schema.ts";
import { HANDOVER_SECONDS, secondStream } from "./stream.ts";

// Tracks shorter than this play untouched.
const MIN_TRACK_SECONDS = 30;

interface FadeIn {
  startedAt: number;
  /** Seconds that ran before a pause. */
  elapsed: number;
  duration: number;
  paused: boolean;
}

export async function startCrossfade(ctx: Ctx) {
  const graph = await ctx.audio();
  const { video, context } = graph;
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
    autoTransition = true;
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
    if (!fadingOut && !fadingIn && position >= fade.start && !stream.ready()) {
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
    autoTransition = false;
    skipped = false;
    fadingOut = false;
    pendingFadeIn = true;
    fadingIn = null;
    stream.prepare(videoId);
  });

  ctx.player.on("trackChange", (track) => stream.prepare(track.videoId));
  const initialTrack = ctx.player.state.track;
  if (initialTrack) stream.prepare(initialTrack.videoId);

  ctx.listen(video, "playing", () => {
    if (pendingFadeIn && !ctx.player.state.ad) startFadeIn();
    else resync();
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

  ctx.listen(video, "timeupdate", onTime);
  ctx.listen(video, "pause", resync);
  ctx.listen(video, "seeked", resync);
  ctx.listen(video, "ratechange", resync);
  // Every option is read when used; re-schedule a fade in progress.
  ctx.onConfigChange(resync);
  ctx.onCleanup(() => stream.release());
}
