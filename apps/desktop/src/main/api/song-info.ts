// The player state mapped to the API's SongInfo shape and mode names.

import { livePosition, type LikeStatus, type NowPlaying, type RepeatMode } from "@pear/sdk";
import { isPlaying } from "@pear/sdk/util";
import type { SongDetails } from "@pear/sdk/song-details";
import type { MediaTypeName, SongInfo } from "./types.ts";

const MUSIC_VIDEO_TYPES: Record<string, MediaTypeName> = {
  MUSIC_VIDEO_TYPE_ATV: "AUDIO",
  MUSIC_VIDEO_TYPE_OMV: "ORIGINAL_MUSIC_VIDEO",
  MUSIC_VIDEO_TYPE_UGC: "USER_GENERATED_CONTENT",
  MUSIC_VIDEO_TYPE_PODCAST_EPISODE: "PODCAST_EPISODE",
};
const MEDIA_TYPES: Record<string, MediaTypeName> = { audio: "AUDIO", video: "ORIGINAL_MUSIC_VIDEO", podcast: "PODCAST_EPISODE" };

export const REPEAT_NAMES: Record<RepeatMode, "NONE" | "ALL" | "ONE"> = { none: "NONE", all: "ALL", one: "ONE" };
export const RATING_NAMES: Record<LikeStatus, "LIKE" | "DISLIKE" | "INDIFFERENT"> = {
  like: "LIKE",
  dislike: "DISLIKE",
  none: "INDIFFERENT",
};

export function isPaused(state: NowPlaying) {
  return state.ad || !isPlaying(state);
}

export function songInfo(state: NowPlaying, details: SongDetails | undefined): SongInfo | null {
  const track = state.track;
  if (!track) return null;
  const extra = details?.videoId === track.videoId ? details : undefined;
  const info: SongInfo = {
    title: track.title,
    artist: track.artist,
    views: extra?.views ?? 0,
    imageSrc: track.artworkUrl ?? null,
    isPaused: isPaused(state),
    songDuration: track.durationSeconds,
    elapsedSeconds: Math.floor(livePosition(state)),
    url: track.url,
    album: track.album ?? null,
    videoId: track.videoId,
    mediaType: MUSIC_VIDEO_TYPES[extra?.musicVideoType ?? ""] ?? MEDIA_TYPES[track.mediaType] ?? "OTHER_VIDEO",
    tags: extra?.tags ?? [],
  };
  if (extra?.alternativeTitle) info.alternativeTitle = extra.alternativeTitle;
  if (extra?.artistUrl) info.artistUrl = extra.artistUrl;
  if (extra?.uploadDate) info.uploadDate = extra.uploadDate;
  if (track.playlistId) info.playlistId = track.playlistId;
  return info;
}
