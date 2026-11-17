// Shared between the host (providers) and the page (renderer).

// The ids are the provider names stored in `preferredProvider`. lrc.red comes
// first: it is the only source with word-synced TTML for most tracks. The rest
// keep the picker order (SimpMusic and the newer sources last), and providers
// added after a stored order are appended.
export const PROVIDERS = [
  "LrcRed",
  "YTMusic",
  "LRCLib",
  "Megalobiz",
  "NetEase",
  "LRCHub",
  "SimpMusic",
  "KuGou",
  "BetterLyrics",
  "Paxsenix",
] as const;
export type ProviderId = (typeof PROVIDERS)[number];

/** Display names for the picker. */
export const PROVIDER_NAMES: Record<ProviderId, string> = {
  LrcRed: "lrc.red",
  YTMusic: "YTMusic",
  LRCLib: "LRCLib",
  Megalobiz: "Megalobiz",
  NetEase: "NetEase",
  LRCHub: "LRCHub",
  SimpMusic: "SimpMusic",
  KuGou: "KuGou",
  BetterLyrics: "BetterLyrics",
  Paxsenix: "Paxsenix",
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

/** The line the renderer is on, as pushed to the host for statusbar-lyrics. */
export interface ActiveLyricLine {
  text: string;
  /** The line's romanization, when the view has one. */
  romanized: string | null;
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
  /** The title in its original language, which YTM offers for some tracks (also searched). */
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

export interface SearchDetails {
  alternativeTitle?: string;
  tags: string[];
}

export function buildSearchQuery(input: {
  videoId: string;
  title: string;
  artist: string;
  album?: string | undefined;
  durationSeconds: number;
  inexact: boolean;
  custom: CustomQuery | null;
  details?: SearchDetails | null;
}): SearchQuery {
  const { custom } = input;
  const query: SearchQuery = {
    videoId: input.videoId,
    title: custom?.query ?? input.title,
    artist: custom ? (custom.artist ?? "") : input.artist,
    durationSeconds: input.durationSeconds,
    inexact: input.inexact,
  };
  if (input.album) query.album = input.album;
  if (custom) query.alternativeTitle = custom.query;
  else if (input.details?.alternativeTitle && input.details.alternativeTitle !== input.title)
    query.alternativeTitle = input.details.alternativeTitle;
  if (input.details?.tags.length) query.tags = input.details.tags;
  return query;
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

/** Scripts the lyric tab can romanize. */
export const ROMANIZATION_SCRIPTS = [
  "ja",
  "ko",
  "zh",
  "th",
  "bn",
  "hi",
  "ta",
  "te",
  "kn",
  "ml",
  "gu",
  "pa",
  "or",
  "ar",
  "fa",
  "ur",
  "he",
  "el",
  "hy",
  "ka",
  "ru",
] as const;
export type RomanizationScript = (typeof ROMANIZATION_SCRIPTS)[number];
export type RomanizationSettings = Record<RomanizationScript, boolean>;

export const ROMANIZATION_SCRIPT_NAMES: Record<RomanizationScript, string> = {
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  th: "Thai",
  bn: "Bengali",
  hi: "Hindi",
  ta: "Tamil",
  te: "Telugu",
  kn: "Kannada",
  ml: "Malayalam",
  gu: "Gujarati",
  pa: "Punjabi",
  or: "Odia",
  ar: "Arabic",
  fa: "Persian",
  ur: "Urdu",
  he: "Hebrew",
  el: "Greek",
  hy: "Armenian",
  ka: "Georgian",
  ru: "Cyrillic",
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

/** Which renderer draws the lyrics: the plugin's own list, or the app's Apple Music renderer. */
export type LyricsStyle = "standard" | "apple-music";
