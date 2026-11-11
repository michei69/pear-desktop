// Now-playing state and player actions, shared by the page runtime (which owns
// the real player) and the host (which mirrors it for OS integrations).

export type MediaType = "audio" | "video" | "podcast" | "other";

export interface Track {
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  /** Largest available artwork. */
  artworkUrl?: string;
  durationSeconds: number;
  url: string;
  playlistId?: string;
  /** View count as YTM reports it, when the player response carries one. */
  views?: number;
  mediaType: MediaType;
}

export type PlaybackStatus = "idle" | "playing" | "paused" | "buffering" | "ended";
export type RepeatMode = "none" | "all" | "one";
export type LikeStatus = "like" | "dislike" | "none";

export interface NowPlaying {
  track: Track | null;
  status: PlaybackStatus;
  positionSeconds: number;
  /** 0–100 */
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  like: LikeStatus;
  /** An ad is playing instead of the track (position and status refer to the track). */
  ad: boolean;
  /** Date.now() of the last update, to extrapolate the position while playing. */
  updatedAt: number;
}

export const IDLE: NowPlaying = {
  track: null,
  status: "idle",
  positionSeconds: 0,
  volume: 100,
  muted: false,
  repeat: "none",
  shuffle: false,
  like: "none",
  ad: false,
  updatedAt: 0,
};

export type PlayerAction =
  | { type: "play" }
  | { type: "pause" }
  | { type: "toggle" }
  | { type: "next" }
  | { type: "previous" }
  | { type: "seek"; seconds: number }
  | { type: "seekBy"; seconds: number }
  | { type: "volume"; value: number }
  | { type: "mute"; muted?: boolean }
  | { type: "like" }
  | { type: "dislike" }
  /** Toggles the like off when it is set, otherwise likes the track. */
  | { type: "unlike" }
  /** Toggles the dislike off when it is set, otherwise dislikes the track. */
  | { type: "undislike" }
  | { type: "shuffle" }
  | { type: "repeat" };

/** Current position, extrapolated from the last update while playing. */
export function livePosition(state: NowPlaying, now = Date.now()) {
  if (state.status !== "playing" || state.ad) return state.positionSeconds;
  const position = state.positionSeconds + (now - state.updatedAt) / 1000;
  return state.track && state.track.durationSeconds > 0 ? Math.min(position, state.track.durationSeconds) : position;
}

export type Unsubscribe = () => void;

/** The parts of YTM's `#movie_player` API the runtime relies on. */
export interface YTPlayerApi extends HTMLElement {
  playVideo(): void;
  pauseVideo(): void;
  /** Some YTM builds expose the ad state only through the player API. */
  getAdState?(): number;
  nextVideo(): void;
  previousVideo(): void;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getVolume(): number;
  setVolume(volume: number): void;
  isMuted(): boolean;
  mute(): void;
  unMute(): void;
  getPlayerState(): number;
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  getAvailablePlaybackRates(): number[];
  getPlaybackQuality(): string;
  getAvailableQualityLevels(): string[];
  setPlaybackQualityRange(min: string, max?: string): void;
  getVideoData(): { video_id: string; title: string; author: string; list?: string; isLive?: boolean };
  getPlayerResponse(): YTPlayerResponse;
  /**
   * The audio tracks the current video offers (languages, original and
   * auto-dubs); absent on player builds without YTM's track selector.
   */
  getAvailableAudioTracks?(): YTPlayerAudioTrack[];
  /** The audio track playing now. */
  getAudioTrack?(): YTPlayerAudioTrack | null;
  /** Switches the audio track; YTM throws when a track cannot be served for this player type. */
  setAudioTrack?(track: YTPlayerAudioTrack): void;
  addEventListener(type: string, listener: (...args: any[]) => void): void;
  removeEventListener(type: string, listener: (...args: any[]) => void): void;
}

/** One audio track of the current video: language info, original or auto-dubbed. */
export interface YTPlayerAudioTrack {
  id?: string;
  /** YTM's language-info object; the shapes differ between player builds. */
  getLanguageInfo?(): {
    getId?(): string;
    getName?(): string;
    getIsDefault?(): boolean;
    getIsAutoDubbed?(): boolean;
  } | null;
  isAutoDubbed?(): boolean;
  [key: string]: unknown;
}

export interface YTPlayerResponse {
  videoDetails?: {
    videoId: string;
    title: string;
    author: string;
    lengthSeconds: string;
    viewCount?: string;
    musicVideoType?: string;
    isLiveContent?: boolean;
    thumbnail?: { thumbnails: { url: string; width: number; height: number }[] };
  };
  microformat?: { microformatDataRenderer?: { urlCanonical?: string; pageOwnerDetails?: { name?: string } } };
  captions?: unknown;
  /** Present on videos with more than one audio track. */
  audioTracks?: unknown;
}
