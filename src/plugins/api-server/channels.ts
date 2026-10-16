/**
 * The IPC contract between the API server's backend and its renderer half.
 *
 * The renderer registers one listener per action on `apiRequest(action)`; the
 * backend sends on `apiRequest(action)` and — for the getters, which are the
 * actions that answer — waits on `apiReply(action)`. Both sides import the
 * names from here so a rename can't silently break the other end into a
 * five-second timeout.
 */

export const ApiActions = {
  /** Getters: the renderer answers on the matching reply channel. */
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
  getLyrics: 'get-lyrics',
  translateLyrics: 'translate-lyrics',
  search: 'search',

  /** Commands: fire and forget. */
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
} as const;

export type ApiAction = (typeof ApiActions)[keyof typeof ApiActions];

export const API_IPC_PREFIX = 'peard-api:';

export const apiRequest = (action: ApiAction) => `${API_IPC_PREFIX}${action}`;

export const apiReply = (action: ApiAction) =>
  `${API_IPC_PREFIX}reply-${action}`;
