// Shared between the host (providers) and the page (renderer).

// The ids are pear-desktop's provider names, which its `preferredProvider` setting
// stores, in the order of its lyrics picker (Megalobiz after Musixmatch). NetEase
// came later, so it is appended to keep stored choices and the picker's order.
export const PROVIDERS = ["YTMusic", "LRCLib", "MusixMatch", "Megalobiz", "LyricsGenius", "NetEase"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

/** As pear-desktop's picker shows them. */
export const PROVIDER_NAMES: Record<ProviderId, string> = {
  YTMusic: "YTMusic",
  LRCLib: "LRCLib",
  MusixMatch: "MusixMatch",
  Megalobiz: "Megalobiz",
  LyricsGenius: "LyricsGenius",
  NetEase: "NetEase",
};

export interface LyricWord {
  startMs: number;
  endMs: number;
  /** Includes its trailing whitespace, so joining words gives the line. */
  text: string;
}

export interface LyricLine {
  startMs: number;
  endMs: number;
  /** Empty for instrumental gaps. */
  text: string;
  /** Present when the provider has word-level timing. */
  words?: LyricWord[];
}

/** A translation the provider ships with its lyrics (NetEase's `tlyric`). */
export interface LyricTranslation {
  /** Timed translated lines, when the provider had timestamps. */
  lines?: LyricLine[];
  /** Newline separated fallback, when the provider only had a text block. */
  plain?: string;
  language?: string;
  provider?: string;
}

export interface LyricResult {
  title: string;
  artists: string[];
  /** Time-synced lines, sorted by start. */
  lines?: LyricLine[];
  /** Unsynced lyrics, newline separated. */
  plain?: string;
  /** The lyrics' page at the provider, for providers that ask to be linked. */
  url?: string;
  /** An official translation that came with the lyrics. */
  translation?: LyricTranslation;
  /** Official romanization, per line (null where the provider has none). */
  romanization?: (string | null)[];
}

export interface SearchQuery {
  videoId: string;
  title: string;
  artist: string;
  album?: string;
  durationSeconds: number;
  /** Accept looser matches (title-only search). */
  inexact: boolean;
  /** The title in its original language, which YTM offers for some tracks (pear-desktop searched it too). */
  alternativeTitle?: string;
  /** The video's tags; the first is often the canonical artist name. */
  tags?: string[];
}

/** How good a result is: word sync > line sync > plain text > nothing. */
export function resultRank(result: LyricResult | null | undefined) {
  if (!result) return 0;
  if (result.lines?.some((line) => line.words?.length)) return 3;
  if (result.lines?.length) return 2;
  return result.plain?.trim() ? 1 : 0;
}

/** A per-song search the user typed in by hand (the picker's custom search). */
export interface CustomQuery {
  query: string;
  artist?: string;
}

// ---- translation settings (flat in the config schema, grouped by the host) ----

export type TranslationProviderName = "openai-compatible" | "anthropic" | "gemini" | "local-cli" | "google-translate";

export const TRANSLATION_PROVIDERS = ["openai-compatible", "anthropic", "gemini", "local-cli", "google-translate"] as const;

export const TRANSLATION_PROVIDER_NAMES: Record<TranslationProviderName, string> = {
  "openai-compatible": "OpenAI-compatible",
  anthropic: "Anthropic",
  gemini: "Gemini",
  "local-cli": "Local CLI",
  "google-translate": "Google Translate",
};

export type TranslationTargetLanguage =
  | "auto"
  | "zh-CN"
  | "zh-TW"
  | "en"
  | "ja"
  | "ko"
  | "fr"
  | "de"
  | "es"
  | "pt-BR"
  | "pt-PT"
  | "it"
  | "nl"
  | "ru"
  | "uk"
  | "pl"
  | "tr"
  | "ar"
  | "he"
  | "fa"
  | "hi"
  | "bn"
  | "ur"
  | "ta"
  | "te"
  | "mr"
  | "id"
  | "ms"
  | "vi"
  | "th"
  | "fil"
  | "sw"
  | "sv"
  | "no"
  | "da"
  | "fi"
  | "cs"
  | "ro"
  | "hu"
  | "el"
  | "bg"
  | "sr"
  | "hr"
  | "sk"
  | "lt";

export const TRANSLATION_TARGET_LANGUAGES: readonly TranslationTargetLanguage[] = [
  "auto",
  "zh-CN",
  "zh-TW",
  "en",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "pt-BR",
  "pt-PT",
  "it",
  "nl",
  "ru",
  "uk",
  "pl",
  "tr",
  "ar",
  "he",
  "fa",
  "hi",
  "bn",
  "ur",
  "ta",
  "te",
  "mr",
  "id",
  "ms",
  "vi",
  "th",
  "fil",
  "sw",
  "sv",
  "no",
  "da",
  "fi",
  "cs",
  "ro",
  "hu",
  "el",
  "bg",
  "sr",
  "hr",
  "sk",
  "lt",
];

export type OpenAICompatibleApiMode = "responses" | "chat-completions" | "auto";
export type LocalCliProviderEngine = "claude" | "codex" | "gemini";
export type LyricsFontSize = "small" | "medium" | "large";
