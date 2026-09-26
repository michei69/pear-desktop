import {
  ALIGNED_WITHIN,
  ALIGN_INTERVAL,
  ALIGN_RATE_LIMIT,
  ALIGN_WINDOW,
  REANCHOR_ABOVE,
} from './constants';

/** Whether an element's clock is parked, on a pause, a seek or a stall. */
export const isStalled = (element: HTMLMediaElement) =>
  element.paused ||
  element.seeking ||
  element.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;

/**
 * Holds the audio's clock on the video's: a drift is run out by playing the
 * audio a hair faster or slower, and one too far out to have come from a start
 * is moved back onto the clock by `reanchor`. The audio is silent until a
 * crossfade hands the track over to it, so neither is heard.
 *
 * @returns the way to stop the alignment
 */
export const alignAudio = (
  element: HTMLMediaElement,
  video: HTMLVideoElement,
  /** Puts the audio back on the video's clock from a standstill. */
  reanchor: () => void,
) => {
  const tick = () => {
    if (isStalled(video) || isStalled(element)) return;

    const drift = video.currentTime - element.currentTime;

    if (Math.abs(drift) < ALIGNED_WITHIN) {
      if (element.playbackRate !== 1) element.playbackRate = 1;
      return;
    }

    // Too far out for any start of this audio to have left it there, so it is
    // started again rather than run back.
    if (Math.abs(drift) > REANCHOR_ABOVE) {
      reanchor();
      return;
    }

    // Rate that closes the drift over the next `ALIGN_WINDOW` seconds: a
    // follower behind its clock plays faster to catch up, one ahead of it plays
    // slower to let it pass, and neither takes the rate further than the limit.
    const rate = Math.min(
      Math.max(1 + drift / ALIGN_WINDOW, 1 - ALIGN_RATE_LIMIT),
      1 + ALIGN_RATE_LIMIT,
    );

    if (element.playbackRate !== rate) element.playbackRate = rate;
  };

  const timer = window.setInterval(tick, ALIGN_INTERVAL);

  return () => {
    window.clearInterval(timer);
    element.playbackRate = 1;
  };
};
