// Changing the captions track can stop the player, so the selector resumes it
// afterwards. pear-desktop only resumed a video that was playing: picking a
// language (or None) while paused must not start playback.

import type { YTPlayerApi } from "@pear/sdk";

/** YTM's `getPlayerState()` value while a video is playing. */
export const PLAYING = 1;

/** Resumes playback, but only when it was playing before the captions switch. */
export function resumeIfPlaying(api: Pick<YTPlayerApi, "getPlayerState" | "playVideo">) {
  if (api.getPlayerState() === PLAYING) api.playVideo();
}
