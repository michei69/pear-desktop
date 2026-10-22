import type { GetPlayerResponse } from './get-player-response';
import type {
  PlayerAPIEvents,
  VideoDataChangeValue,
} from './player-api-events';
import type { VideoDetails } from './video-details';
import type { WatchNextResponse } from '@/types/music-player-desktop-internal';

/**
 * The presenter a player API call targets.
 *
 * - `1` — main watch-page player
 * - `2` — ad player
 * - `3` — cast/remote (MDX) presenter
 */
export type PlayerType = 1 | 2 | 3;

/**
 * Playback state returned by `getPlayerState` and `onStateChange`.
 *
 * - `-1` — unstarted
 * - `0` — ended
 * - `1` — playing
 * - `2` — paused
 * - `3` — buffering
 * - `5` — cued
 */
export type PlayerState = -1 | 0 | 1 | 2 | 3 | 5;

/**
 * Visibility state returned by `getVisibilityState`.
 *
 * - `0` — default
 * - `1` — minimized
 * - `2` — fullscreen
 * - `3` — background
 * - `4` — AirPlay
 * - `5` — inline
 * - `6` — VR
 * - `7` — picture-in-picture
 * - `8` — immersive preview
 * - `9` — squeezeback
 * - `10` — theater
 * - `31` — invalid
 */
export type VisibilityState = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 31;

/**
 * Autonav mode accepted by `setAutonavState`.
 *
 * - `1` — off
 * - `2` — on
 * - `3` — temporary
 */
export type AutonavState = 1 | 2 | 3;

/** Generic object used for opaque player data and module-specific options. */
export type PlayerObject = Record<string, unknown>;

/** Options accepted by the state and data getters. */
export interface PlayerQueryOptions {
  playerType?: PlayerType;
  /** Ignore edits/overrides and return the raw value. */
  IE?: boolean;
  /** Pin the call to a specific client playback nonce. */
  cpn?: string;
  /** Internal state query flag. */
  qE?: boolean;
  [key: string]: unknown;
}

/** Spec accepted by the video cue/load methods. */
export interface PlayerVideoSpec {
  videoId: string;
  startSeconds?: number;
  suggestedQuality?: string;
  embedConfig?: PlayerObject | string;
  embed_config?: PlayerObject;
  [key: string]: unknown;
}

/** Spec accepted by the URL cue/load methods. */
export interface PlayerUrlSpec {
  mediaContentUrl: string;
  startSeconds?: number;
  suggestedQuality?: string;
  [key: string]: unknown;
}

/** Spec accepted by the playlist cue/load methods. */
export interface PlayerPlaylistSpec {
  list?: string;
  playlist?: string;
  listType?: string;
  index?: number;
  startSeconds?: number;
  suggestedQuality?: string;
  [key: string]: unknown;
}

/** Flat playerVars payload used by the playerVars loaders. */
export interface PlayerVars {
  video_id?: string;
  videoId?: string;
  start?: number;
  startSeconds?: number;
  list?: string;
  player_params?: string;
  itct?: string;
  csi_timer?: string;
  external_list?: boolean;
  suppress_creator_endscreen?: boolean;
  aac_high?: boolean;
  prefer_low_quality_audio?: boolean;
  audio_only?: string;
  autoplay?: boolean;
  autonav?: boolean;
  pause_at_start?: boolean;
  prefer_gapless?: boolean;
  rco?: boolean;
  cco?: boolean;
  force_ads_url?: string;
  raw_player_response?: GetPlayerResponse | PlayerObject;
  qoe_cat?: string;
  cpn?: string;
  eventid?: string;
  title?: string;
  author?: string;
  length_seconds?: string | number;
  hl?: string;
  url_encoded_fmt_stream_map?: string;
  adaptive_fmts?: string;
  fmt_list?: string;
  dashmpd?: string;
  hlsvp?: string;
  live_playback?: boolean;
  post_live_playback?: boolean;
  storyboard_spec?: string;
  live_storyboard_spec?: string;
  sabrCaptionsDataLoaded?: string;
  [key: string]: unknown;
}

/** Pixel dimensions of the player. */
export interface PlayerSize {
  width: number;
  height: number;
}

/** Rectangle of the video content area. */
export interface PlayerRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Boolean playback-state snapshot returned by `getPlayerStateObject`. */
export interface PlayerStateObject {
  isBuffering: boolean;
  isCued: boolean;
  isDomPaused: boolean;
  isEnded: boolean;
  isError: boolean;
  isOrWillBePlaying: boolean;
  isPaused: boolean;
  isPlaying: boolean;
  isSeeking: boolean;
  isUiSeeking: boolean;
  isUnstarted: boolean;
}

/** Progress/seekbar state returned by `getProgressState`. */
export interface ProgressState {
  airingStart: number;
  airingEnd: number;
  allowSeeking: boolean;
  clipEnd: number;
  clipStart: number;
  current: number;
  displayedStart: number;
  duration: number;
  ingestionTime: number;
  isAtLiveHead: boolean;
  loaded: number;
  offset: number;
  seekableEnd: number;
  seekableStart: number;
  viewerLivestreamJoinMediaTime: number;
}

/** Language metadata attached to an audio track. */
export interface AudioLanguageInfo {
  name: string;
  id: string;
  isDefault: boolean;
  isAutoDubbed: boolean;
  getName: () => string;
  getId: () => string;
  getIsDefault: () => boolean;
  getIsAutoDubbed: () => boolean;
  toString: () => string;
}

/** One selectable audio track. */
export interface PlayerAudioTrack {
  id: string;
  getLanguageInfo: () => AudioLanguageInfo;
  getXtags: () => string;
  isAutoDubbed: () => boolean;
  toString: () => string;
}

/** One entry in the player's quality-data map. */
export interface QualityData {
  quality: string;
  qualityLabel: string;
  [key: string]: unknown;
}

/** One storyboard image level. */
export interface StoryboardLevel {
  index: number;
  intervalMs: number;
  maxFrameIndex: number;
  minFrameIndex: number;
}

/** One rendered storyboard frame. */
export interface StoryboardFrame {
  column: number;
  columns: number;
  height: number;
  row: number;
  rows: number;
  url: string;
  width: number;
}

/** Watch-time data returned by the sleep-timer module. */
export interface AccumulatedWatchTime {
  cpn: string;
  accumulatedWatchTimeMillis: number;
}

/** Statistics dictionary returned by `getStatsForNerds`. */
export interface StatsForNerds {
  video_id_and_cpn: string;
  codecs: string;
  dims_and_frames: string;
  bandwidth_kbps: string;
  buffer_health_seconds: string;
  date: string;
  drm: string;
  drm_style: string;
  debug_info: string;
  extra_debug_info: string;
  bandwidth_style: string;
  network_activity_style: string;
  network_activity_bytes: string;
  shader_info: string;
  shader_info_style: string;
  playback_categories: string;
  playback_categories_style: string;
  volume: string;
  resolution: string;
  color?: string;
  color_style?: string;
  fmt_debug_info?: string;
  fmt_debug_info_style?: string;
  live_mode?: string;
  live_mode_style?: string;
  live_latency_secs?: string;
  live_latency_style?: string;
  cotn_and_local_media?: string;
  cotn_and_local_media_style?: string;
  release_name?: string;
  release_style?: string;
  extra_debug_info_style?: string;
  bandwidth_samples?: unknown[];
  network_activity_samples?: unknown[];
  live_latency_samples?: unknown[];
  buffer_health_samples?: unknown[];
  [key: string]: unknown;
}

/** Cue range accepted by `addCueRange`/`removeCueRange`. */
export interface CueRange {
  id?: string;
  identifier?: string;
  startSecs?: number;
  endSecs?: number;
  [key: string]: unknown;
}

/** Loop range accepted by `setLoopRange`. */
export interface LoopRange {
  start?: number;
  end?: number;
  startTimeMs?: number;
  endTimeMs?: number;
  postId?: string;
  type?: string;
  loopCount?: number;
  [key: string]: unknown;
}

/** Subtitle settings passed to the subtitle configuration methods. */
export interface SubtitlesUserSettings {
  [key: string]: unknown;
}

/** Redux action accepted by `dispatchReduxAction`. */
export interface PlayerReduxAction {
  type: string;
  payload?: unknown;
}

/** Video data delivered by the `onVideoDataChange` event. */
export interface VideoDataChangeEvent {
  type: 'newdata' | 'dataloaded' | 'dataupdated';
  videoData: VideoDataChangeValue;
  playertype: PlayerType;
}

/** Error data delivered by the `onDetailedError` event. */
export interface DetailedErrorEvent {
  errorCode: string;
  errorDetail?: string;
  message?: string;
  messageKey?: string;
  cpn?: string;
}

/** Volume data delivered by the `onVolumeChange` event. */
export interface VolumeChangeEvent {
  volume: number;
  muted: boolean;
}

/** Payload map for the player's public events. */
export interface PlayerAPIEventPayloads extends Omit<
  PlayerAPIEvents,
  'videodatachange'
> {
  videodatachange: {
    value: VideoDataChangeValue;
    name: 'newdata' | 'dataloaded' | 'dataupdated';
  };
  onReady: MusicPlayer;
  onAdStateChange: number;
  onVideoDataChange: VideoDataChangeEvent;
  onAdStart: undefined;
  onAdEnd: undefined;
  onAdMetadataAvailable: undefined;
  onAdPlaybackProgress: PlayerObject;
  onDetailedError: DetailedErrorEvent;
  onError: number | string;
  onVolumeChange: VolumeChangeEvent;
  onPlaybackQualityChange: string;
  onPlaybackRateChange: number;
  onPlaybackAudioChange: PlayerObject;
  onAutoplayBlocked: undefined;
  onCaptionsModuleAvailable: undefined;
  onCueRangeEnter: PlayerObject;
  onPlaybackStartExternal: undefined;
  onLoadProgress: PlayerObject;
  onOfflineOperationFailure: PlayerObject;
  onOrchestrationBecameLeader: undefined;
  onOrchestrationLostLeader: undefined;
  onShowControls: undefined;
  onHideControls: undefined;
  onApiChange: PlayerObject;
  onPlaybackPauseAtStart: undefined;
  onPlaylistUpdate: PlayerObject;
  onSnackbarMessage: string;
  onVideoAreaChange: PlayerObject;
  onFilterAudioFeatures: PlayerObject;
  onLoadedMetadata: undefined;
  onPlaylistNext: undefined;
  onPlaylistPrevious: undefined;
}

/** The arguments one player API event delivers to its listener. */
export type PlayerAPIEventArgs<K extends keyof PlayerAPIEventPayloads> =
  K extends 'videodatachange'
    ? [
        name: PlayerAPIEventPayloads[K]['name'],
        data: PlayerAPIEventPayloads[K]['value'],
      ]
    : K extends 'onStateChange' | 'onVideoProgress'
      ? [payload: PlayerAPIEventPayloads[K]]
      : PlayerAPIEventPayloads[K] extends undefined
        ? []
        : [payload: PlayerAPIEventPayloads[K]];

export interface MusicPlayer {
  // Playback control
  playVideo: (options?: PlayerObject) => void;
  pauseVideo: (playerType?: PlayerType) => void;
  /** Stops playback and unloads the current video. */
  stopVideo: (playerType?: PlayerType) => void;
  cancelPlayback: () => void;
  clearVideo: () => void;
  cueVideoById: (
    video: string | PlayerVideoSpec,
    startSeconds?: number,
    playerVarsOrQuality?: PlayerObject | string,
  ) => void;
  loadVideoById: (
    video: string | PlayerVideoSpec,
    startSeconds?: number,
    playerVarsOrQuality?: PlayerObject | string,
  ) => void;
  preloadVideoById: (
    video: string | PlayerVideoSpec,
    startSeconds?: number,
    playerVarsOrQuality?: PlayerObject | string,
  ) => void;
  cueVideoByUrl: (
    url: string | PlayerUrlSpec,
    startSeconds?: number,
    suggestedQuality?: string,
  ) => void;
  loadVideoByUrl: (
    url: string | PlayerUrlSpec,
    startSeconds?: number,
    suggestedQuality?: string,
  ) => void;
  cueVideoByPlayerVars: (vars: PlayerVars, playerType?: PlayerType) => void;
  loadVideoByPlayerVars: (
    vars: PlayerVars,
    start?: number,
    playerType?: PlayerType,
    cpn?: string,
  ) => void;
  preloadVideoByPlayerVars: (
    vars: PlayerVars,
    playerType?: PlayerType,
    start?: number,
    cpn?: string,
  ) => void;
  enqueueVideoByPlayerVars: (
    vars: PlayerVars,
    start?: number,
    cpn?: string,
    ...args: unknown[]
  ) => void;
  queueNextVideo: (
    videoId: string,
    index?: number,
    cpn?: string,
    ...args: unknown[]
  ) => void;
  clearQueue: () => void;
  seekTo: (
    seconds: number,
    allowSeekAhead?: boolean,
    options?: PlayerObject,
    playerType?: number,
    seekSource?: number,
  ) => void;
  seekBy: (seconds: number, allowSeekAhead?: boolean, reason?: number) => void;
  seekToLiveHead: (playerType?: PlayerType, ...args: unknown[]) => void;
  requestSeekToWallTimeSeconds: (
    wallTimeSeconds: number,
    ...args: unknown[]
  ) => void;
  seekToStreamTime: (
    seconds: number,
    wallTime?: number,
    duration?: number,
    playerType?: PlayerType,
  ) => void;
  startSeekCsiAction: () => void;
  getStreamTimeOffset: () => number;
  initiateUnifiedSeek: (spec: PlayerObject) => void;
  haltUnifiedSeek: (seekId: string | number) => void;
  setPlaybackRate: (playbackRate: number) => void;
  getPlaybackRate: () => number;
  getAvailablePlaybackRates: () => number[];

  // State and data
  getInternalApiInterface: () => string[];
  getApiInterface: () => string[];
  getTrustedApi: () => Record<string, (...args: unknown[]) => unknown>;
  getPlayerState: (playerType?: PlayerType) => PlayerState;
  getPlayerStateObject: (playerType?: PlayerType) => PlayerStateObject;
  getAdState: () => number;
  getCurrentTime: (
    options?: PlayerType | PlayerQueryOptions,
    ignoreEdits?: boolean,
    cpn?: string,
  ) => number;
  getCurrentTimeForUx: (options?: PlayerQueryOptions) => number;
  getDuration: (
    options?: PlayerType | PlayerQueryOptions,
    ignoreEdits?: boolean,
  ) => number;
  getDurationForUx: (options?: PlayerQueryOptions) => number;
  getVideoLoadedFraction: (playerType?: PlayerType) => number;
  getVideoBytesLoaded: () => number;
  getVideoBytesTotal: () => number;
  getVideoStartBytes: () => number;
  getProgressState: (playerType?: PlayerType) => ProgressState;
  getMediaReferenceTime: () => number;
  getVideoData: (options?: PlayerType | PlayerQueryOptions) => VideoDetails;
  updateVideoData: (data: PlayerObject, ...args: unknown[]) => void;
  updateEnvironmentData: (environment: PlayerObject) => void;
  addCueRange: (
    id: string,
    startSec: number,
    endSec: number,
    data?: unknown,
    flag?: unknown,
  ) => void;
  addUtcCueRange: (
    id: string,
    startUtcSec: number,
    endUtcSec: number,
    data?: unknown,
    flag?: unknown,
  ) => void;
  removeCueRange: (id: string) => void;
  getPlayerResponse: (playerType?: PlayerType) => GetPlayerResponse;
  getEmbeddedPlayerResponse: () => GetPlayerResponse;
  getWatchNextResponse: (playerType?: PlayerType) => WatchNextResponse;
  getHeartbeatResponse: (playerType?: PlayerType) => PlayerObject;
  getVideoStats: () => PlayerObject;
  getStatsForNerds: () => StatsForNerds;
  getAppState: () => number;
  getPresentingPlayerType: (allowAdFallback?: boolean) => PlayerType;
  getVisibilityState: () => VisibilityState;
  shouldSendVisibilityState: () => boolean;
  isNotServable: (videoId: string) => boolean;
  getDebugText: (playerType?: PlayerType) => string;
  isAtLiveHead: (playerType?: PlayerType, tolerance?: boolean) => boolean;
  isKeyboardDisabled: () => boolean;
  isInline: () => boolean;
  setInline: (isInline: boolean) => void;
  isFullscreen: () => boolean;
  toggleFullscreen: () => Promise<void>;

  // Volume, audio and quality
  getVolume: () => number;
  /** @param volume 0-100 */
  setVolume: (volume: number, sendEvent?: boolean) => void;
  mute: (flag?: boolean) => void;
  unMute: (flag?: boolean) => void;
  isMuted: () => boolean;
  syncVolume: () => void;
  getAudioTrack: () => PlayerAudioTrack | null;
  setAudioTrack: (
    track: PlayerAudioTrack,
    force?: boolean,
    playerType?: PlayerType,
  ) => void;
  getAvailableAudioTracks: () => PlayerAudioTrack[];
  supportsGaplessAudio: () => boolean;
  supportsGaplessShorts: () => boolean;
  isGaplessTransitionReady: (spec?: PlayerObject) => boolean;
  togglePictureInPicture: () => void;
  showAirplayPicker: () => void;
  getPreferredQuality: () => string;
  getPlaybackQualityLabel: (playerType?: PlayerType) => string;
  getAvailableQualityLabels: () => string[];
  setPlaybackQualityRange: (
    minQuality: string,
    maxQuality?: string,
    playerType?: PlayerType,
  ) => void;
  setPlaybackQuality: (quality: string, playerType?: PlayerType) => void;
  getPlaybackQuality: (playerType?: PlayerType) => string;
  getMaxPlaybackQuality: () => string;
  getUserPlaybackQualityPreference: () => string;
  getVideoAspectRatio: () => number;
  canPlayType: (mimeType: string, ...args: unknown[]) => string;
  getVideoContentRect: (playerType?: PlayerType) => PlayerRect;
  getStoryboardFormat: () => string | null;
  getStoryboardFrame: (
    level?: number,
    ...args: unknown[]
  ) => StoryboardFrame | null;
  getStoryboardFrameIndex: (level: number, time: number) => number;
  getStoryboardLevel: (level: number) => StoryboardLevel | null;
  getNumberOfStoryboardLevels: () => number;
  setCenterCrop: (enabled: boolean) => void;
  setGlobalCrop: (rect: PlayerRect) => void;
  setInternalSize: (width: number, height: number) => void;
  setSizeStyle: (flagA: boolean, flagB: boolean) => void;
  setSize: {
    (size: PlayerSize): void;
    (width: number, height: number): void;
  };
  getPlayerSize: () => PlayerSize;
  getSize: () => PlayerSize;
  getAvailableQualityLevels: (playerType?: PlayerType) => string[];
  getPlayerMode: () => PlayerObject;

  // Playlists, queue and navigation
  cuePlaylist: (
    playlist: string | PlayerPlaylistSpec,
    index?: number,
    startSeconds?: number,
    ...args: unknown[]
  ) => void;
  loadPlaylist: (
    playlist: string | PlayerPlaylistSpec,
    index?: number,
    startSeconds?: number,
    ...args: unknown[]
  ) => void;
  updatePlaylist: (playlist: PlayerObject) => void;
  nextVideo: (playerType?: PlayerType, ...args: unknown[]) => void;
  previousVideo: (playerType?: PlayerType) => void;
  playVideoAt: (index: number) => void;
  setShuffle: (shuffle: boolean) => void;
  setLoop: (loop: boolean) => void;
  setLoopVideo: (value: boolean) => void;
  getLoopVideo: () => boolean;
  setLoopRange: (range: LoopRange | null) => void;
  getLoopRange: () => LoopRange | null;
  getPlaylist: (playerType?: PlayerType) => unknown[];
  getPlaylistIndex: () => number;
  getPlaylistId: () => string | undefined;
  setAutonav: (enabled: boolean, fromServer?: boolean) => void;
  setAutonavState: (state: AutonavState, fromServer?: boolean) => void;
  getCurrentPlaylistSequence: () => unknown[];
  getPlaylistSequenceForTime: (seconds: number) => unknown[] | null;
  setMinimized: (minimized: boolean) => void;

  // Modules, options and subtitles
  loadModule: (moduleName: string) => void;
  unloadModule: (moduleName: string) => void;
  getOptions: (scope?: string) => PlayerObject;
  setOption: <T>(scope: string, key: string, value: T) => void;
  getOption: <T = unknown>(
    scope: string,
    key: string,
    playerType?: PlayerType,
  ) => T | null | undefined;
  toggleSubtitlesOn: (enabled: boolean) => void;
  toggleSubtitles: () => void;
  isSubtitlesOn: () => boolean;
  getCaptionWindowContainerId: () => string;
  getSubtitlesUserSettings: () => SubtitlesUserSettings;
  updateSubtitlesUserSettings: (
    settings: Partial<SubtitlesUserSettings>,
    applyToSession?: boolean,
  ) => void;
  resetSubtitlesUserSettings: () => void;

  // Events
  addEventListener: {
    <K extends keyof PlayerAPIEventPayloads>(
      type: K,
      listener: (this: Document, ...args: PlayerAPIEventArgs<K>) => void,
      options?: boolean | AddEventListenerOptions,
    ): void;
    (
      type: string,
      listener: (this: Document, ...args: unknown[]) => void,
      options?: boolean | AddEventListenerOptions,
    ): void;
  };
  removeEventListener: {
    <K extends keyof PlayerAPIEventPayloads>(
      type: K,
      listener: (this: Document, ...args: PlayerAPIEventArgs<K>) => void,
      options?: boolean | EventListenerOptions,
    ): void;
    (
      type: string,
      listener: (this: Document, ...args: unknown[]) => void,
      options?: boolean | EventListenerOptions,
    ): void;
  };

  // Logging, engagement and lifecycle
  sendAbandonmentPing: () => void;
  updateLastActiveTime: () => void;
  setUserEngagement: (engaged: boolean) => void;
  setSafetyMode: (enabled: boolean) => void;
  sendVideoStatsEngageEvent: (event: unknown, ...args: unknown[]) => void;
  dispatchReduxAction: (action: PlayerReduxAction) => void;
  logApiCall: (name: string, ...args: unknown[]) => void;
  isExternalMethodAvailable: (name: string, ...args: unknown[]) => boolean;
  handleExternalCall: (name: string, ...args: unknown[]) => unknown;
  onAdUxClicked: (uxId: string, layoutId: string) => void;
  getFeedbackProductData: () => PlayerObject;
  getWebPlayerContextConfig: () => PlayerObject;
  reportPlaybackIssue: (issue?: string) => void;
  confirmYpcRental: () => void;
  channelSubscribed: () => void;
  channelUnsubscribed: () => void;
  productsInVideoVisibilityUpdated: (visible: boolean) => void;
  setBlackout: (blackout: boolean) => void;
  setInlinePreview: (preview: PlayerObject) => void;
  setSqueezeback: (squeezeback: PlayerObject) => void;
  setOverlayVisibility: (visible: boolean) => void;
  setScreenLayer: (layer: number) => void;
  setFauxFullscreen: (enabled: boolean) => void;
  setAppFullscreen: (enabled: boolean) => void;
  highlightSettingsMenuItem: (menuItem: string) => void;
  openSettingsMenuItem: (menuItem: string) => void;
  notifyShortsAdSwipeEvent: () => void;
  setShortsAutoAdvancedEnabled: (enabled: boolean) => void;
  prefetchKeyPlay: (videoId: string, ...args: unknown[]) => void;
  prefetchJumpAhead: (seconds: number) => void;
  isOrchestrationLeader: () => boolean;
  isMutedByMutedAutoplay: () => boolean;
  isMutedByEmbedsMutedAutoplay: () => boolean;
  isEmbedsShortsMode: () => boolean;
  getVideoEmbedCode: (
    videoId?: string,
    width?: number,
    height?: number,
    list?: string,
  ) => string;
  getVideoUrl: (videoId?: string, list?: string, ...args: unknown[]) => string;
  mutedAutoplay: (enabled?: boolean) => void;
  wakeUpControls: () => void;
  showControls: () => void;
  hideControls: () => void;
  forceExperimentFlagsForTesting: (flags: PlayerObject) => void;
  handleGlobalKeyDown: (event: KeyboardEvent, ...args: unknown[]) => void;
  handleGlobalKeyUp: (event: KeyboardEvent, ...args: unknown[]) => void;
  logImaAdEvent: (eventType: string, breakType: string) => void;
  destroy: () => void;
  isReady: () => boolean;
  getLastError: () => Error | null;
  getPlayerType: () => string;
  getCurrentVideoConfig: () => PlayerObject;
  loadNewVideoConfig: (config: PlayerObject) => void;

  // Dynamic player-module extensions
  addEmbedsConversionTrackingParams: (params: PlayerObject) => void;
  addOrUpdateOnlinePlaybackPosition: (
    videoId: string,
    positionSeconds: number,
    timestampMs: number,
  ) => Promise<void>;
  getOnlinePlaybackPosition: (videoId: string) => Promise<number | undefined>;
  deleteOnlinePlaybackPosition: (videoId: string) => Promise<void>;
  setUpPositionSyncInterval: (intervalMs: number) => void;
  setVideoTimeLeft: (timeLeft: string) => void;
  addShoppingTimelyShelfOverlay: (overlay: PlayerObject) => void;
  dismissFeaturedProductOverlay: (dismissed: boolean) => void;
  changeMarkerVisibility: (
    visible: boolean,
    markerTypes: unknown[],
    restrictionMode?: string,
  ) => void;
  isSameMarkerTypeVisible: (markerType: unknown) => boolean;
  createClientVe: (
    target: unknown,
    component?: unknown,
    id?: number,
    required?: boolean,
  ) => unknown;
  createServerVe: (
    target: unknown,
    component?: unknown,
    id?: number,
    required?: boolean,
  ) => unknown;
  destroyVe: () => void;
  hasVe: () => boolean;
  logClick: (target: PlayerObject) => void;
  logVisibility: (target: PlayerObject) => void;
  setTrackingParams: (params: PlayerObject) => void;
  getAvailableQualityData: () => QualityData[];
  getAvailableQualityDataAndMessaging: () => {
    qualityData: QualityData[];
    qualityMessagingFormattedString?: string;
  };
  getPaygatedAudioQualityData: () => QualityData[];
  getAudioQualitySettingState: () => number;
  getUserAudioQualitySetting: () => string | number;
  setUserAudioQualitySetting: (setting: string) => void;
  getAudioTrackState: () => number;
  hasDrcAudioTrack: () => boolean;
  hasHqaAudioTrack: () => boolean;
  getDrcState: () => number;
  getDrcUserPreference: () => number;
  setDrcUserPreference: (preference: number) => void;
  getVoiceBoostState: () => number;
  getVoiceBoostUserPreference: () => number;
  setVoiceBoostUserPreference: (preference: number) => void;
  getReelItemWatchResponse: () => PlayerObject | null;
  getResolveUrlResponse: () => PlayerObject | null;
  getSphericalProperties: () => PlayerObject;
  setSphericalProperties: (properties: PlayerObject) => void;
  getTimelyActionTriggerSource: () => string | null;
  insertTimelyActionUi: (action: PlayerObject) => void;
  showVideoInfo: () => void;
  hideVideoInfo: () => void;
  isVideoInfoVisible: () => boolean;
  isLifaAdPlaying: () => boolean;
  musicEnableUi: (enabled: boolean) => void;
  musicDisableUi: (disabled: boolean) => void;
  pauseVideoDownload: (videoId: string) => void;
  resumeVideoDownload: (videoId: string) => void;
  queueOfflineAction: (action: PlayerObject) => void;
  updateDownloadState: (state: PlayerObject) => void;
  refreshAllStaleEntities: () => void;
  renderChapterSeekingAnimation: (
    from: PlayerObject,
    to: PlayerObject,
    options: PlayerObject,
  ) => void;
  seekToChapterWithAnimation: (chapterIndex: number) => void;
  seekToTimeWithAnimation: (seconds: number) => void;
  setMacroMarkers: (markers: unknown[]) => void;
  getAccumulatedWatchTime: () => AccumulatedWatchTime | null;
  resetSleepTimerMenuSettings: () => void;
  setSleepTimerTimeLeft: (seconds: number) => void;
  setAccountLinkState: (state: string) => void;
  updateAccountLinkingConfig: (config: PlayerObject) => void;
  setCompositeParam: (param: PlayerObject) => void;
  setCompositeVideoOverlayRendererComponent: (renderer: PlayerObject) => void;
  setCreatorEndscreenHideButton: (hidden: boolean) => void;
  setCreatorEndscreenVisibility: (visible: boolean) => void;
  setDocumentPictureInPicture: (enabled: boolean) => void;
  setFreePreviewUsageDetails: (details: PlayerObject) => void;
  setFreePreviewWatchedDuration: (seconds: number) => void;
  setFullscreenGrid: (enabled: boolean) => void;
  setFullscreenQuickActions: (enabled: boolean) => void;
  updateFullerscreenEduButtonSubtleModeState: (subtle: boolean) => void;
  updateFullerscreenEduButtonVisibility: (visible: boolean) => void;
  setPlayerOverlayVideoDetailsRenderer: (renderer: PlayerObject) => void;
  showPlaybackIcon: (visible: boolean) => void;
  setCommentsButton: (button: PlayerObject) => void;
  setDescriptionButton: (button: PlayerObject) => void;
  updateCinematicSettings: (settings: PlayerObject) => void;
}
