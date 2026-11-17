// The Amuse (6K Labs) query shape: every field is always present because the
// clients treat a missing key as a malformed provider.

import { livePosition, type MediaType, type NowPlaying } from "@pear/sdk";
import { formatDuration, isPaused } from "@pear/sdk/util";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };

/** The coarse SDK type, used when the raw YTM type is not known yet. */
const MEDIA_TYPES: Record<MediaType, string> = { audio: "AUDIO", video: "VIDEO", podcast: "PODCAST", other: "OTHER" };
/** The five wire values (`MediaType` in the song-info types). */
const VIDEO_TYPES: Record<string, string> = {
  MUSIC_VIDEO_TYPE_ATV: "AUDIO",
  MUSIC_VIDEO_TYPE_OMV: "ORIGINAL_MUSIC_VIDEO",
  MUSIC_VIDEO_TYPE_UGC: "USER_GENERATED_CONTENT",
  MUSIC_VIDEO_TYPE_PODCAST_EPISODE: "PODCAST_EPISODE",
  MUSIC_VIDEO_TYPE_OTHER: "OTHER_VIDEO",
};
const LIKE_STATUS = { like: "LIKE", dislike: "DISLIKE", none: "INDIFFERENT" } as const;
const REPEAT_TYPE = { none: "NONE", all: "ALL", one: "ONE" } as const;

/** The raw YTM media type when the page knows it, else the coarse fallback. */
export function wireMediaType(mediaType: MediaType, musicVideoType: string | undefined) {
  return (musicVideoType && VIDEO_TYPES[musicVideoType]) || MEDIA_TYPES[mediaType];
}

/** An OMV is a music video, but it is reported as `isVideo: false` here. */
export function isVideoType(wireType: string) {
  return wireType !== "AUDIO" && wireType !== "ORIGINAL_MUSIC_VIDEO";
}

export function songInfo(state: NowPlaying, musicVideoType?: string) {
  const track = state.track;
  const position = Math.floor(livePosition(state));
  const duration = Math.floor(track?.durationSeconds ?? 0);
  const mediaType = track ? wireMediaType(track.mediaType, musicVideoType) : "AUDIO";
  return {
    apiVersion: 2,
    player: {
      hasSong: !!(track?.title && track.artist),
      isPaused: isPaused(state),
      volumePercent: state.volume,
      seekbarCurrentPosition: position,
      seekbarCurrentPositionHuman: formatDuration(position),
      statePercent: duration > 0 ? Math.round((position / duration) * 100) : 0,
      likeStatus: LIKE_STATUS[state.like],
      repeatType: REPEAT_TYPE[state.repeat],
      // Lets a client extrapolate between polls instead of freezing the seekbar.
      positionUpdatedAt: state.updatedAt,
    },
    track: {
      author: track?.artist ?? "",
      title: track?.title ?? "",
      album: track?.album ?? "",
      cover: track?.artworkUrl ?? "",
      duration,
      durationHuman: formatDuration(duration),
      url: track?.url ?? "",
      id: track?.videoId ?? "",
      isVideo: isVideoType(mediaType),
      // Carried even when the ad's metadata never arrives: hardcoding false here
      // collapsed the two modes into one on the wire.
      isAdvertisement: state.ad,
      inLibrary: false,
      mediaType,
      playlistId: track?.playlistId || null,
    },
  };
}

export { CORS };
