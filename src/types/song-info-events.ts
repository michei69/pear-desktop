/**
 * Renderer → main: requests song-info listeners as a bitmask of
 * `SongInfoEventFlag` values, so a consumer arms all it needs in one message.
 * Replaces the per-event `peard:setup-*-listener` channels.
 */
export const SONG_INFO_SETUP_CHANNEL = 'peard:setup-song-info-listeners';

export const SongInfoEventFlag = {
  Seeked: 1 << 0,
  TimeChanged: 1 << 1,
  LikeChanged: 1 << 2,
  RepeatChanged: 1 << 3,
  VolumeChanged: 1 << 4,
  PlaybackSpeedChanged: 1 << 5,
  ShuffleChanged: 1 << 6,
  FullscreenChanged: 1 << 7,
  AutoPlayChanged: 1 << 8,
} as const;

export type SongInfoEventFlag =
  (typeof SongInfoEventFlag)[keyof typeof SongInfoEventFlag];
