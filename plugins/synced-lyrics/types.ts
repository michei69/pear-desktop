// Shared between the host (providers) and the page (renderer).

// The ids are pear-desktop's provider names, which its `preferredProvider` setting
// stores. lrc.red comes first: it is the only source with word-synced TTML for most
// tracks. The rest keep pear-desktop's picker order (Megalobiz after Musixmatch,
// NetEase last), and providers added after a stored order are appended.
export const PROVIDERS = ["LrcRed", "YTMusic", "LRCLib", "MusixMatch", "Megalobiz", "NetEase", "LRCHub", "SimpMusic"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

/** As pear-desktop's picker shows them. */
export const PROVIDER_NAMES: Record<ProviderId, string> = {
  LrcRed: "lrc.red",
  YTMusic: "YTMusic",
  LRCLib: "LRCLib",
  MusixMatch: "MusixMatch",
  Megalobiz: "Megalobiz",
  NetEase: "NetEase",
  LRCHub: "LRCHub",
  SimpMusic: "SimpMusic",
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
  /** Timing of background vocals sung over this line (TTML providers). */
  background?: LyricWord[];
  /** Duet line alignment: right-aligned when the other singer takes over. */
  alignment?: "start" | "end";
  /** Right-to-left line, so the karaoke fill runs right-to-left. */
  rtl?: boolean;
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

/** How lyrics are timed, best first: the default type order. */
export const LYRICS_TYPES = ["word", "synced", "plain"] as const;
export type LyricsType = (typeof LYRICS_TYPES)[number];

/** How a result is timed; null when it has no lyrics at all. */
export function lyricsType(result: LyricResult | null | undefined): LyricsType | null {
  if (!result) return null;
  if (result.lines?.some((line) => line.words?.length)) return "word";
  if (result.lines?.length) return "synced";
  return result.plain?.trim() ? "plain" : null;
}

const TYPE_RANK: Record<LyricsType, number> = { word: 3, synced: 2, plain: 1 };

/** How good a result is: word sync > line sync > plain text > nothing. */
export function resultRank(result: LyricResult | null | undefined) {
  const type = lyricsType(result);
  return type ? TYPE_RANK[type] : 0;
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

/** Which renderer draws the lyrics: the plugin's own list, or am-lyrics in Apple Music style. */
export type LyricsStyle = "standard" | "apple-music";
