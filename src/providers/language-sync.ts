import { languageCodes } from 'virtual:i18n';

import type { BrowserWindow } from 'electron';

/** App language -> the `hl` value YouTube expects. */
const TO_YOUTUBE: Record<string, string> = {
  'pt': 'pt-PT', // portuguese is reversed for some reason
  'pt-BR': 'pt',
  'nb': 'no', // norsk is nb in the app
  'be-Latn': 'be', // be-Latn doesnt exist in ytm
  // these dont exist in ytm
  'ckb': 'en',
  'kmr': 'en',
  'he': 'en',
  'qu': 'en',
  'sah': 'ru',
};

/** YouTube `hl` value -> app language, for the ones that arent 1:1. */
const TO_APP: Record<string, string> = {
  'pt': 'pt-BR', // portuguese is reversed for some reason
  'pt-PT': 'pt',
  'zh-HK': 'zh-TW', // we dont have zh-HK
  'no': 'nb', // norsk is nb
};

/**
 * The language YouTube is currently set to, or undefined with no YouTube
 * session yet or when we dont ship it.
 */
export const youtubeLanguage = async (
  win: BrowserWindow,
): Promise<string | undefined> => {
  const [cookie] = await win.webContents.session.cookies.get({ name: 'PREF' });
  if (!cookie) return undefined;

  const hl =
    cookie.value
      .split('&')
      .find((entry) => entry.startsWith('hl='))
      ?.split('=')[1] || 'en';

  // Locales we ship as a single variant.
  let lang = hl;
  if (lang.startsWith('en-')) lang = 'en';
  else if (lang.startsWith('fr-')) lang = 'fr';
  else if (lang.startsWith('es-')) lang = 'es';
  else if (TO_APP[lang]) lang = TO_APP[lang];

  return languageCodes.includes(lang) ? lang : undefined;
};

/** Points YouTube at one of our languages; take a reload to see. */
export const setYouTubeLanguage = async (
  win: BrowserWindow,
  lang: string,
): Promise<void> => {
  const [cookie] = await win.webContents.session.cookies.get({ name: 'PREF' });
  const prefs = cookie?.value ?? '';
  const current = prefs.split('&').find((entry) => entry.startsWith('hl='));
  const hl = `hl=${TO_YOUTUBE[lang] ?? lang}`;
  // With no hl entry (or no cookie at all) the old value would be written back
  // unchanged, so add one instead of replacing.
  const value = current
    ? prefs.replace(current, hl)
    : [prefs, hl].filter(Boolean).join('&');

  const details: Electron.CookiesSetDetails = {
    name: 'PREF',
    url: 'https://music.youtube.com',
    value,
  };
  // Stay on the existing .youtube.com cookie rather than adding a host-only one.
  if (cookie?.domain) details.domain = cookie.domain;

  await win.webContents.session.cookies.set(details);
  win.webContents.reload();
};
