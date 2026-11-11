// Tuna's song payload, in pear-desktop's shape. Kept separate so the mapping is
// testable without Electron's fetch.

import { type NowPlaying, type Track, livePosition } from "@pear/sdk";
import type { SongDetails } from "@pear/sdk/song-details";
import { isPlaying } from "@pear/sdk/util";

export function songData(state: NowPlaying, track: Track, details: SongDetails | undefined) {
  const extra = details?.videoId === track.videoId ? details : undefined;
  return {
    album: track.album ?? null,
    album_url: track.artworkUrl ?? "",
    artists: [track.artist],
    cover: track.artworkUrl ?? "",
    cover_url: track.artworkUrl ?? "",
    duration: Math.round(track.durationSeconds * 1000),
    progress: Math.round(livePosition(state) * 1000),
    // A buffer stall is not a pause: OBS must keep showing the track as playing.
    status: !state.ad && isPlaying(state) ? "playing" : "stopped",
    title: track.title,
    alternativeTitle: extra?.alternativeTitle ?? "",
    url: track.url,
    tags: extra?.tags ?? [],
  };
}
