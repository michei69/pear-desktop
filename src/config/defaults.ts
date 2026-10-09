import type { UpdateChannel } from '@/app-info';

export interface WindowSizeConfig {
  width: number;
  height: number;
}

export interface WindowPositionConfig {
  x: number;
  y: number;
}

export interface DefaultConfig {
  'window-size': WindowSizeConfig;
  'window-maximized': boolean;
  'window-position': WindowPositionConfig;
  'url': string;
  'options': {
    language?: string;
    tray: boolean;
    appVisible: boolean;
    autoUpdates: boolean;
    updateChannel: UpdateChannel;
    alwaysOnTop: boolean;
    hideMenu: boolean;
    hideMenuWarned: boolean;
    startAtLogin: boolean;
    disableHardwareAcceleration: boolean;
    removeUpgradeButton: boolean;
    restartOnConfigChanges: boolean;
    trayClickPlayPause: boolean;
    trayMoveToCurrentDesktop: boolean;
    trayForceWhiteIcons: boolean;
    useYtmIcons: boolean;
    autoResetAppCache: boolean;
    forceSmtc: boolean;
    resumeOnStart: boolean;
    likeButtons: string;
    swapLikeButtonsOrder: boolean;
    proxy: string;
    startingPage: string;
    overrideUserAgent: boolean;
    usePodcastParticipantAsArtist: boolean;
    stripMusicFromSharedLinks: boolean;
    stripSIFromSharedLinks: boolean;
    /** Id of the selected external theme, or '' for no theme. */
    theme: string;
    /**
     * Preset the user picked per theme id: a preset name, `custom` for the
     * palette they edited themselves, or '' for the theme's own palette.
     */
    themePresets: Record<string, string>;
    /** Per-theme palette overrides, keyed by theme id then palette key. */
    themeOverrides: Record<string, Record<string, string>>;
    /** Hash of the theme JS the user consented to run, keyed by theme id. */
    themeConsent: Record<string, string>;
    /** Whether the first-run theme has been seeded. */
    themesSeeded: boolean;
    customWindowTitle?: string;
  };
  'plugins': Record<string, unknown>;
}

export const defaultConfig: DefaultConfig = {
  'window-size': {
    width: 1100,
    height: 550,
  },
  'window-maximized': false,
  'window-position': {
    x: -1,
    y: -1,
  },
  'url': 'https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com',
  'options': {
    tray: false,
    appVisible: true,
    autoUpdates: true,
    updateChannel: 'stable',
    alwaysOnTop: false,
    hideMenu: false,
    hideMenuWarned: false,
    startAtLogin: false,
    disableHardwareAcceleration: false,
    removeUpgradeButton: false,
    restartOnConfigChanges: false,
    trayClickPlayPause: false,
    trayMoveToCurrentDesktop: false,
    trayForceWhiteIcons: false,
    useYtmIcons: false,
    autoResetAppCache: false,
    forceSmtc: false,
    resumeOnStart: true,
    likeButtons: '',
    swapLikeButtonsOrder: false,
    proxy: '',
    startingPage: '',
    overrideUserAgent: false,
    usePodcastParticipantAsArtist: false,
    stripMusicFromSharedLinks: false,
    stripSIFromSharedLinks: true,
    theme: '',
    themePresets: {},
    themeOverrides: {},
    themeConsent: {},
    themesSeeded: false,
  },
  'plugins': {},
};
