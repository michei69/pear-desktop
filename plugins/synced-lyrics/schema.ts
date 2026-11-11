import { config, type ConfigOf } from "@pear/sdk";
import {
  LYRICS_TYPES,
  PROVIDER_NAMES,
  PROVIDERS,
  TRANSLATION_PROVIDERS,
  TRANSLATION_PROVIDER_NAMES,
  TRANSLATION_TARGET_LANGUAGES,
  ROMANIZATION_SCRIPT_NAMES,
  ROMANIZATION_SCRIPTS,
  type RomanizationScript,
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
  lyricsStyle: config.select(
    "standard",
    [
      { value: "standard", label: "Standard" },
      { value: "apple-music", label: "Apple Music" },
    ],
    {
      label: "Lyrics style",
      description:
        "Apple Music draws the lyrics with the app's own word-by-word karaoke renderer. Lyrics size applies to both styles; line effects and instrumental breaks apply to Standard.",
    },
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
  lineEffect: config.select(
    "fancy",
    [
      { value: "fancy", label: "Fancy (glow)" },
      { value: "scale", label: "Scale" },
      { value: "offset", label: "Offset" },
      { value: "focus", label: "Focus (blur others)" },
    ],
    { label: "Current line effect", visibleWhen: { lyricsStyle: "standard" } },
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
      { value: "custom", label: "Custom" },
    ],
    { label: "Instrumental breaks", visibleWhen: { lyricsStyle: "standard" } },
  ),
  gapTextCustom: config.string("", {
    label: "Custom break text",
    description: "Shown when the break choice is Custom.",
    placeholder: "♪",
    visibleWhen: { lyricsStyle: "standard", gapText: "custom" },
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
  romanizationScripts: config.multi(
    [...ROMANIZATION_SCRIPTS],
    ROMANIZATION_SCRIPTS.map((value) => ({ value, label: ROMANIZATION_SCRIPT_NAMES[value] })),
    {
      label: "Languages",
      description: "Lyrics written in these scripts get a romanized line under the original.",
      group: "Romanization",
    },
  ),
  convertChinese: config.select(
    "off",
    [
      { value: "off", label: "Keep as is" },
      { value: "s2t", label: "Simplified → Traditional" },
      { value: "t2s", label: "Traditional → Simplified" },
    ],
    { label: "Chinese characters", group: "Romanization" },
  ),
  convertJapanese: config.select(
    "off",
    [
      { value: "off", label: "Keep as is" },
      { value: "hiragana", label: "Kanji → Hiragana" },
      { value: "katakana", label: "Kanji → Katakana" },
    ],
    {
      label: "Japanese characters",
      description:
        "Kuroshiro replaces kanji with dictionary readings. Names and ambiguous words can be misread; the Japanese dictionary (about 17 MB) downloads on first use.",
      group: "Romanization",
    },
  ),
  // Legacy switches, read once by the host when upgrading a granular config.
  romanizeJapanese: config.bool(true, { label: "Japanese", hidden: true }),
  romanizeKorean: config.bool(true, { label: "Korean", hidden: true }),
  romanizeChinese: config.bool(true, { label: "Chinese", hidden: true }),
  romanizeThai: config.bool(true, { label: "Thai", hidden: true }),
  romanizeBengali: config.bool(true, { label: "Bengali", hidden: true }),
  romanizeHindi: config.bool(true, { label: "Hindi", hidden: true }),
  romanizeTamil: config.bool(true, { label: "Tamil", hidden: true }),
  romanizeTelugu: config.bool(true, { label: "Telugu", hidden: true }),
  romanizeKannada: config.bool(true, { label: "Kannada", hidden: true }),
  romanizeMalayalam: config.bool(true, { label: "Malayalam", hidden: true }),
  romanizeGujarati: config.bool(true, { label: "Gujarati", hidden: true }),
  romanizePunjabi: config.bool(true, { label: "Punjabi", hidden: true }),
  romanizeOdia: config.bool(true, { label: "Odia", hidden: true }),
  romanizeArabic: config.bool(true, { label: "Arabic", hidden: true }),
  romanizePersian: config.bool(true, { label: "Persian", hidden: true }),
  romanizeUrdu: config.bool(true, { label: "Urdu", hidden: true }),
  romanizeHebrew: config.bool(true, { label: "Hebrew", hidden: true }),
  romanizeGreek: config.bool(true, { label: "Greek", hidden: true }),
  romanizeArmenian: config.bool(true, { label: "Armenian", hidden: true }),
  romanizeGeorgian: config.bool(true, { label: "Georgian", hidden: true }),
  romanizeCyrillic: config.bool(true, { label: "Cyrillic", hidden: true }),
  // Legacy master switch; the host copies it onto every language once, then the
  // individual switches take over.
  romanization: config.bool(true, { label: "Romanize lyrics", hidden: true }),
  romanizationMigrated: config.bool(false, { label: "Romanization legacy value migrated", hidden: true }),
  romanizationScriptsMigrated: config.bool(false, { label: "Romanization languages migrated", hidden: true }),
  showLyricsEvenIfInexact: config.bool(true, {
    label: "Show lyrics even if inexact",
    description: "Also try looser searches; may occasionally match a different version of the song.",
  }),
  showCustomSearchButton: config.bool(true, {
    label: "Show custom search",
    description: "A button in the lyrics picker to search with your own title and artist for the current song, remembered per song.",
  }),
  useYTMLyricsWithoutProxy: config.bool(true, {
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
    visibleWhen: { musixmatchTokenMode: "user" },
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
    visibleWhen: { translationProvider: "openai-compatible" },
  }),
  openaiApiKey: config.string("", {
    label: "API key",
    group: "OpenAI-compatible",
    secret: true,
    visibleWhen: { translationProvider: "openai-compatible" },
  }),
  openaiModel: config.string("gpt-4o-mini", {
    label: "Model",
    group: "OpenAI-compatible",
    visibleWhen: { translationProvider: "openai-compatible" },
  }),
  openaiApiMode: config.select(
    "auto",
    [
      { value: "auto", label: "Auto" },
      { value: "responses", label: "Responses API" },
      { value: "chat-completions", label: "Chat completions" },
    ],
    {
      label: "API mode",
      group: "OpenAI-compatible",
      variant: "chips",
      visibleWhen: { translationProvider: "openai-compatible" },
    },
  ),
  anthropicApiKey: config.string("", {
    label: "Anthropic API key",
    group: "Anthropic",
    secret: true,
    visibleWhen: { translationProvider: "anthropic" },
  }),
  anthropicModel: config.string("claude-haiku-4-5-20251001", {
    label: "Anthropic model",
    group: "Anthropic",
    visibleWhen: { translationProvider: "anthropic" },
  }),
  geminiApiKey: config.string("", {
    label: "Gemini API key",
    group: "Gemini",
    secret: true,
    visibleWhen: { translationProvider: "gemini" },
  }),
  geminiModel: config.string("gemini-2.0-flash", {
    label: "Gemini model",
    group: "Gemini",
    visibleWhen: { translationProvider: "gemini" },
  }),
  localCliEngine: config.select(
    "claude",
    [
      { value: "claude", label: "Claude Code" },
      { value: "codex", label: "Codex" },
      { value: "gemini", label: "Gemini CLI" },
    ],
    { label: "Local CLI", group: "Local CLI", visibleWhen: { translationProvider: "local-cli" } },
  ),
  localCliCommand: config.string("", {
    label: "Command",
    description: "The executable to run (default: the engine's command).",
    group: "Local CLI",
    visibleWhen: { translationProvider: "local-cli" },
  }),
  localCliModel: config.string("", {
    label: "Model",
    description: "Optional model passed to the CLI.",
    group: "Local CLI",
    visibleWhen: { translationProvider: "local-cli" },
  }),
  localCliTimeoutSeconds: config.number(120, {
    label: "Timeout",
    min: 15,
    max: 600,
    step: 5,
    unit: "s",
    group: "Local CLI",
    visibleWhen: { translationProvider: "local-cli" },
  }),
  googleTranslateHost: config.string("translate.google.com", {
    label: "Google Translate host",
    description: "A regional host such as translate.google.co.jp, or your own Google Translate mirror.",
    group: "Google Translate",
    visibleWhen: { translationProvider: "google-translate" },
  }),
};

export type LyricsConfig = ConfigOf<typeof schema>;

/** Config key for each romanizable script, in the settings order. */
export const ROMANIZATION_KEYS = {
  ja: "romanizeJapanese",
  ko: "romanizeKorean",
  zh: "romanizeChinese",
  th: "romanizeThai",
  bn: "romanizeBengali",
  hi: "romanizeHindi",
  ta: "romanizeTamil",
  te: "romanizeTelugu",
  kn: "romanizeKannada",
  ml: "romanizeMalayalam",
  gu: "romanizeGujarati",
  pa: "romanizePunjabi",
  or: "romanizeOdia",
  ar: "romanizeArabic",
  fa: "romanizePersian",
  ur: "romanizeUrdu",
  he: "romanizeHebrew",
  el: "romanizeGreek",
  hy: "romanizeArmenian",
  ka: "romanizeGeorgian",
  ru: "romanizeCyrillic",
} as const satisfies Record<RomanizationScript, keyof LyricsConfig>;
