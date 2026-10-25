// The active language's strings (English underneath, for untranslated keys).
// English and the active language are loaded at startup; every other
// translation file is a chunk that nothing imports, so the main bundle never
// carries them.

import { flatten, type Strings, type Translate, translator } from "@pear/sdk/i18n";
import { languageCodes, loadLanguageResources } from "virtual:pear/i18n";

const AVAILABLE = new Set(languageCodes);

/** The configured language if there is one, else the system's, else English. */
export function resolveLanguage(configured: string, systemLocale: string): string {
  const available = (code: string) => (AVAILABLE.has(code) ? code : undefined);
  if (configured && available(configured)) return configured;
  // "pt-BR" -> "pt-BR", then "pt"; "zh-Hant-TW" -> "zh-Hant-TW", "zh-Hant", "zh".
  const parts = systemLocale.split(/[-_]/);
  for (let length = parts.length; length > 0; length--) {
    const code = available(parts.slice(0, length).join("-"));
    if (code) return code;
  }
  return "en";
}

export interface I18n {
  readonly language: string;
  readonly strings: Strings;
  readonly t: Translate;
}

// Untranslated entries are empty strings in Weblate's files; drop them so English shows.
const nonEmpty = (strings: Record<string, string>) => Object.fromEntries(Object.entries(strings).filter(([, value]) => value));

const EMPTY: Record<string, Record<string, unknown>> = {};

/** A language's resources, or nothing (logged) when its chunk fails to load. */
async function loadResources(code: string) {
  try {
    return await loadLanguageResources([code]);
  } catch (error) {
    console.error(`[pear] ${code} translations couldn't be loaded`, error);
    return EMPTY;
  }
}

export async function loadI18n(language: string): Promise<I18n> {
  const english = loadResources("en");
  const translated = language === "en" ? Promise.resolve(EMPTY) : loadResources(language);
  const [englishResources, translatedResources] = await Promise.all([english, translated]);
  const strings = {
    ...nonEmpty(flatten(englishResources.en ?? {})),
    ...nonEmpty(flatten(translatedResources[language] ?? {})),
  };
  return { language, strings, t: translator(strings) };
}
