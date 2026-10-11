import { APPLICATION_NAME } from '@/i18n';

import { HANGUL_FILLER } from './constants';

import type { DiscordPluginConfig } from './index';
import type { SongInfo } from '@/providers/song-info';
import type { GatewayActivityButton } from 'discord-api-types/v10';

export const truncateString = (str: string, length: number): string => {
  if (str.length > length) {
    return `${str.substring(0, length - 3)}...`;
  }
  return str;
};

export function sanitizeActivityText(
  input: string | undefined,
  fallback: string = 'undefined',
): string {
  const text = input && input.trim() ? input.trim() : fallback.trim();
  let safeString = truncateString(text, 128);

  if (safeString.length === 0) {
    return fallback;
  }

  if (safeString.length < 2) {
    safeString = safeString.padEnd(2, '⠀'); // U+2800 braille blank, not HANGUL_FILLER
  }

  return safeString;
}

export const buildDiscordButtons = (
  config: DiscordPluginConfig,
  songInfo: SongInfo,
): GatewayActivityButton[] | undefined => {
  const buttons: GatewayActivityButton[] = [];
  if (
    config[
      'playOn\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u004d\u0075\u0073\u0069\u0063'
    ] &&
    songInfo.url
  ) {
    buttons.push({
      label: `Play on ${APPLICATION_NAME}`,
      url: songInfo.url,
    });
  }
  if (!config.hideGitHubButton) {
    buttons.push({
      label: 'View App On GitHub',
      url: 'https://github.com/michei69/pear-desktop',
    });
  }
  return buttons.length ? buttons : undefined;
};

/** Pads title/artist/album to Discord's 2-character minimum (mutates songInfo) */
export const padHangulFields = (songInfo: SongInfo): void => {
  (['title', 'artist', 'album'] as const).forEach((key) => {
    const value = songInfo[key];
    if (typeof value === 'string' && value.length > 0 && value.length < 2) {
      songInfo[key] = value + HANGUL_FILLER.repeat(2 - value.length);
    }
  });
};

export const isSeek = (oldSeconds: number, newSeconds: number): boolean => {
  // A >2s jump is a seek; smaller gaps are reporting jitter
  return Math.abs(newSeconds - oldSeconds) > 2;
};
