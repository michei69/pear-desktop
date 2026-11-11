import { config, type ConfigOf } from "@pear/sdk";
import {
  LYRICS_TYPES,
  PROVIDER_NAMES,
  PROVIDERS,
  TRANSLATION_PROVIDERS,
  TRANSLATION_PROVIDER_NAMES,
  TRANSLATION_TARGET_LANGUAGES,
  type TranslationProviderName,
  type TranslationTargetLanguage,
} from "./types.ts";

const providerOptions: { value: TranslationProviderName; label: string }[] = TRANSLATION_PROVIDERS.map((value) => ({
  value,
  label: TRANSLATION_PROVIDER_NAMES[value],
}));

const languageOptions: { value: TranslationTargetLanguage; label: string }[] = TRANSLATION_TARGET_LANGUAGES.map((value) => ({
  value,
  label: value === "auto" ? "App language" : value,
}));

/** Fixed priority lists: the order is a setting, but its entries come from the code. */
const providerOrder = PROVIDERS.map((value) => ({ value, label: PROVIDER_NAMES[value] }));
const lyricsTypeOrder = [
  { value: "word", label: "Word-by-word" },
  { value: "synced", label: "Time-synced" },
  { value: "plain", label: "Plain" },
] as const;

export const schema = {
  preferredProvider: config.select(
    "auto",
    [
      // pear-desktop's provider names, so its setting carries over.
      { value: "auto", label: "Best available" },
      { value: "LrcRed", label: "lrc.red" },
      { value: "LRCLib", label: "LRCLIB" },
      { value: "YTMusic", label: "\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u0020\u004d\u0075\u0073\u0069\u0063" },
      { value: "MusixMatch", label: "Musixmatch" },
      { value: "Megalobiz", label: "Megalobiz" },
      { value: "NetEase", label: "NetEase" },
      { value: "LRCHub", label: "LRCHub" },
      { value: "SimpMusic", label: "SimpMusic" },
    ],
    { label: "Preferred provider", description: "Breaks ties between providers with equally rich lyrics; the type order still wins." },
  ),
  usePriorityList: config.bool(false, {
    label: "Follow the provider order",
    description:
      "Use the list below instead of the richest result: the first provider in the order with lyrics wins. Off ranks providers by result quality (word-synced, time-synced, official translations) and the preferred provider breaks ties.",
  }),
  providerPriority: config.orderable([...PROVIDERS], providerOrder, {
    label: "Provider order",
    description:
      "Tried from top to bottom when the order is followed, and used to break ties otherwise. Providers missing from the list are tried last.",
  }),
  lyricsTypePriority: config.orderable([...LYRICS_TYPES], lyricsTypeOrder, {
    label: "Lyrics type order",
    description:
      "Lyrics are picked by type in this order: a word-by-word result wins over a time-synced one over a plain text block. Providers with the same kind of lyrics are picked by the provider order.",
  }),
  preciseTiming: config.bool(true, {
    label: "Precise line timing",
    description:
      "End a line at its own end time. Off keeps it highlighted until the next line starts, which smooths providers with clipped timings.",
  }),
  lineEffect: config.select(
    "fancy",
    [
      { value: "fancy", label: "Fancy (glow)" },
      { value: "scale", label: "Scale" },
      { value: "offset", label: "Offset" },
      { value: "focus", label: "Focus (blur others)" },
    ],
    { label: "Current line effect" },
  ),
  lyricsFontSize: config.select(
    "small",
    [
      { value: "small", label: "Small" },
      { value: "medium", label: "Medium" },
      { value: "large", label: "Large" },
    ],
    { label: "Lyrics size", variant: "chips" },
  ),
  lyricsStyle: config.select(
    "standard",
    [
      { value: "standard", label: "Standard" },
      { value: "apple-music", label: "Apple Music" },
    ],
    {
      label: "Lyrics style",
      description:
        "Apple Music draws the lyrics with am-lyrics and its word-by-word karaoke animation. Line effects and lyrics size only apply to the standard style.",
    },
  ),
  gapText: config.select(
    // ♪ by default, as pear-desktop. "Nothing" leaves the break blank.
    "note",
    [
      { value: "dots", label: "Animated dots" },
      { value: "bullets", label: "•••" },
      { value: "note", label: "♪" },
      { value: "dash", label: "———" },
      { value: "none", label: "Nothing" },
    ],
    { label: "Instrumental breaks" },
  ),
  gapTextCustom: config.string("", {
    label: "Custom break text",
    description: "Shown instead of the choice above when a line has no lyrics; leave empty to keep the choice.",
    placeholder: "♪",
  }),
  showTimeCodes: config.bool(false, { label: "Show time codes" }),
  offsetMs: config.number(0, {
    label: "Timing offset",
    description: "Positive values show lines earlier.",
    min: -2000,
    max: 2000,
    step: 50,
    unit: "ms",
  }),
  romanization: config.bool(true, {
    label: "Romanize lyrics",
    description: "Japanese, Korean and Chinese. The Japanese dictionary (about 17 MB) downloads on first use.",
  }),
  convertChinese: config.select(
    "off",
    [
      { value: "off", label: "Keep as is" },
      { value: "s2t", label: "Simplified → Traditional" },
      { value: "t2s", label: "Traditional → Simplified" },
    ],
    { label: "Chinese characters" },
  ),
  showLyricsEvenIfInexact: config.bool(true, {
    label: "Show lyrics even if inexact",
    description: "Also try looser searches; may occasionally match a different version of the song.",
  }),
  showCustomSearchButton: config.bool(true, {
    label: "Show custom search",
    description: "A button in the lyrics picker to search with your own title and artist for the current song, remembered per song.",
  }),
  useYTMLyricsWithoutProxy: config.bool(false, {
    label: "\u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music lyrics without proxy",
    description:
      "Fetch \u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music's own lyrics directly instead of through the public browse proxy. Off asks the proxy first and falls back to the direct request.",
  }),
  musixmatchTokenMode: config.select(
    "auto",
    [
      { value: "auto", label: "Automatic (mobile app token)" },
      { value: "user", label: "Your own token" },
    ],
    {
      label: "Musixmatch token source",
      description:
        "Automatic asks Musixmatch for the mobile app's token and renews it every minute. Your own token sends the token below instead.",
    },
  ),
  musixmatchToken: config.string("", {
    label: "Musixmatch user token",
    description: "The usertoken of your own signed-in Musixmatch app, sent when the token source above is your own token.",
    secret: true,
  }),

  // ---- Translation (flat keys, because a plugin's config is one record) ----
  translationEnabled: config.bool(false, {
    label: "Translate lyrics",
    description: "Translate the lyrics shown in the Lyrics tab, and let the app's API translate on request.",
    group: "Translation",
  }),
  translationProvider: config.select("openai-compatible", providerOptions, {
    label: "Translation provider",
    group: "Translation",
  }),
  translationTargetLanguage: config.select("auto", languageOptions, {
    label: "Translate into",
    description: "The app language by default. Translating lyrics already in that language returns them unchanged.",
    variant: "dropdown",
    group: "Translation",
  }),
  openaiBaseUrl: config.string("https://api.openai.com/v1", {
    label: "OpenAI-compatible base URL",
    description: "Any OpenAI-compatible server; /responses and /chat/completions are supported.",
    group: "OpenAI-compatible",
  }),
  openaiApiKey: config.string("", { label: "API key", group: "OpenAI-compatible", secret: true }),
  openaiModel: config.string("gpt-4o-mini", { label: "Model", group: "OpenAI-compatible" }),
  openaiApiMode: config.select(
    "auto",
    [
      { value: "auto", label: "Auto" },
      { value: "responses", label: "Responses API" },
      { value: "chat-completions", label: "Chat completions" },
    ],
    { label: "API mode", group: "OpenAI-compatible", variant: "chips" },
  ),
  anthropicApiKey: config.string("", { label: "Anthropic API key", group: "Anthropic", secret: true }),
  anthropicModel: config.string("claude-haiku-4-5-20251001", { label: "Anthropic model", group: "Anthropic" }),
  geminiApiKey: config.string("", { label: "Gemini API key", group: "Gemini", secret: true }),
  geminiModel: config.string("gemini-2.0-flash", { label: "Gemini model", group: "Gemini" }),
  localCliEngine: config.select(
    "claude",
    [
      { value: "claude", label: "Claude Code" },
      { value: "codex", label: "Codex" },
      { value: "gemini", label: "Gemini CLI" },
    ],
    { label: "Local CLI", group: "Local CLI" },
  ),
  localCliCommand: config.string("", {
    label: "Command",
    description: "The executable to run (default: the engine's command).",
    group: "Local CLI",
  }),
  localCliModel: config.string("", { label: "Model", description: "Optional model passed to the CLI.", group: "Local CLI" }),
  localCliTimeoutSeconds: config.number(120, {
    label: "Timeout",
    min: 15,
    max: 600,
    step: 5,
    unit: "s",
    group: "Local CLI",
  }),
  googleTranslateHost: config.string("translate.google.com", {
    label: "Google Translate host",
    description: "A regional host such as translate.google.co.jp, or your own Google Translate mirror.",
    group: "Google Translate",
  }),
};

export type LyricsConfig = ConfigOf<typeof schema>;
