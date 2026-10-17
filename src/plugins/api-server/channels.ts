/**
 * The IPC contract between the API server's backend and its renderer half.
 *
 * The renderer registers one listener per action on `apiRequest(action)`; the
 * backend sends on `apiRequest(action)` and — for the getters, which are the
 * actions that answer — waits on `apiReply(action)`. Both sides import the
 * names from here so a rename can't silently break the other end into a
 * five-second timeout.
 */

/** Getters: the renderer answers on the matching reply channel. */
const queryActions = {
  getVideo: 'get-video',
  getPlaying: 'get-playing',
  getPlaybackSpeed: 'get-playback-speed',
  getPlaybackPosition: 'get-playback-position',
  getShuffle: 'get-shuffle',
  getRepeat: 'get-repeat',
  getVolume: 'get-volume',
  getMute: 'get-mute',
  getLikeState: 'get-like-state',
  getQueue: 'get-queue',
  getAutoplay: 'get-autoplay',
  getLyrics: 'get-lyrics',
  translateLyrics: 'translate-lyrics',
  search: 'search',
  browse: 'browse',
} as const;

/** Commands: fire and forget, so nothing waits on a reply. */
export const commandActions = {
  nextVideo: 'next-video',
  previousVideo: 'previous-video',
  play: 'play',
  pause: 'pause',
  togglePlay: 'toggle-play',
  setPlaybackSpeed: 'set-playback-speed',
  seekTo: 'seek-to',
  seekBy: 'seek-by',
  shuffle: 'shuffle',
  setShuffle: 'set-shuffle',
  setRepeat: 'set-repeat',
  switchRepeat: 'switch-repeat',
  setVolume: 'set-volume',
  setMute: 'set-mute',
  toggleMute: 'toggle-mute',
  setLikeState: 'set-like-state',
  like: 'like',
  dislike: 'dislike',
  unlike: 'unlike',
  addToQueue: 'add-to-queue',
  moveInQueue: 'move-in-queue',
  removeFromQueue: 'remove-from-queue',
  setQueueIndex: 'set-queue-index',
  clearQueue: 'clear-queue',
  downloadVideo: 'download-video',
} as const;

export const ApiActions = { ...queryActions, ...commandActions } as const;

export type ApiAction = (typeof ApiActions)[keyof typeof ApiActions];

export const API_IPC_PREFIX = 'peard-api:';

export const apiRequest = (action: ApiAction) => `${API_IPC_PREFIX}${action}`;

export const apiReply = (action: ApiAction) =>
  `${API_IPC_PREFIX}reply-${action}`;

/**
 * Events the v2 renderer pushes to the backend for the WebSocket. The backend
 * rebroadcasts them as `LYRICS_CHANGED` / `TRANSLATION_UPDATED`.
 */
export const V2RendererEvents = {
  lyricsChanged: `${API_IPC_PREFIX}lyrics-changed`,
  translationUpdated: `${API_IPC_PREFIX}translation-updated`,
} as const;

export type V2RendererEvent =
  (typeof V2RendererEvents)[keyof typeof V2RendererEvents];

/** Same shape as `GET /video/lyrics`; broadcast as `LYRICS_CHANGED`. */
export interface LyricsChangedPayload {
  videoId: string | null;
  activeProvider: string | null;
  providers: unknown[];
}

/** Broadcast as `TRANSLATION_UPDATED` when the shown translation finishes. */
export interface TranslationUpdatedPayload {
  videoId: string;
  language: string | null;
  provider: string | null;
  lines: string[];
}
