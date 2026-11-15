// Keeping the app's language and YTM's `PREF` cookie in step. The cookie holds
// `hl=` next to YTM's other preferences, so only that entry is replaced.

import type { BrowserWindow, Session } from "electron";
import { languageCodes } from "virtual:pear/i18n";
import { YTM_ORIGIN } from "../shared/user-agent.ts";

/** App language -> the `hl` value YTM expects. */
const TO_YTM: Record<string, string> = {
  pt: "pt-PT", // portuguese is reversed for some reason
  "pt-BR": "pt",
  nb: "no", // norsk is nb in the app
  "be-Latn": "be", // be-Latn doesn't exist in YTM
  // these don't exist in YTM
  ckb: "en",
  kmr: "en",
  he: "en",
  qu: "en",
  sah: "ru",
};

/** YTM `hl` value -> app language, for the ones that aren't 1:1. */
const TO_APP: Record<string, string> = {
  pt: "pt-BR", // portuguese is reversed for some reason
  "pt-PT": "pt",
  "zh-HK": "zh-TW", // we don't have zh-HK
  no: "nb", // norsk is nb
};

const PREF_URL = YTM_ORIGIN;

/** The app language for a YTM `hl` value, when we ship it. */
export function appLanguage(hl: string): string | undefined {
  let language = hl;
  if (language.startsWith("en-")) language = "en";
  else if (language.startsWith("fr-")) language = "fr";
  else if (language.startsWith("es-")) language = "es";
  else language = TO_APP[language] ?? language;
  return languageCodes.includes(language) ? language : undefined;
}

/** The `hl` value for an app language. */
export function ytmLanguage(language: string): string {
  return TO_YTM[language] ?? language;
}

/** Reads YTM's current `hl` from the PREF cookie; undefined with no session or an unsupported value. */
export async function languageFromYtm(session: Session): Promise<string | undefined> {
  const [cookie] = await session.cookies.get({ name: "PREF" });
  if (!cookie) return undefined;
  const hl =
    cookie.value
      .split("&")
      .find((entry) => entry.startsWith("hl="))
      ?.split("=")[1] || "en";
  return appLanguage(hl);
}

/** Points YTM at one of our languages; the caller reloads to apply it. */
export async function setYtmLanguage(session: Session, window: BrowserWindow | undefined, language: string) {
  const [cookie] = await session.cookies.get({ name: "PREF" });
  const prefs = cookie?.value ?? "";
  const current = prefs.split("&").find((entry) => entry.startsWith("hl="));
  const hl = `hl=${ytmLanguage(language)}`;
  // With no hl entry (or no cookie at all) the old value would be written back
  // unchanged, so add one instead of replacing.
  const value = current ? prefs.replace(current, hl) : [prefs, hl].filter(Boolean).join("&");

  const details: Electron.CookiesSetDetails = { name: "PREF", url: PREF_URL, value };
  // Stay on the existing cookie rather than adding a host-only one.
  if (cookie?.domain) details.domain = cookie.domain;

  await session.cookies.set(details);
  window?.webContents.reload();
}
