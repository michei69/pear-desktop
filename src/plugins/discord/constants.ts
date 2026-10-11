/**
 * Application ID registered by @th-ch/pear-desktop dev team
 */
export const clientId = '1177081335727267940';
export const PROGRESS_THROTTLE_MS = 15_000;
export const TIME_UPDATE_DEBOUNCE_MS = 5000;
/**
 * Discord activity fields must be at least 2 characters, so short Hangul strings get padded
 */
export const HANGUL_FILLER = '\u3164';

export enum TimerKey {
  ClearActivity = 'clearActivity', // clears activity after a pause
  UpdateTimeout = 'updateTimeout',
  DiscordConnectRetry = 'discordConnectRetry',
}
