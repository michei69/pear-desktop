// Target-language resolution and a small source-language check, so translation
// is skipped when the lyrics are already in the requested language. Scripts are
// detected exactly; Latin languages use common function words, which is enough
// for lyrics and avoids pulling in a language-detection dependency.

import type { TranslationTargetLanguage } from "../types.ts";

export function resolveTargetLanguage(target: TranslationTargetLanguage | string, locale: string) {
  if (target && target !== "auto") return target;
  const normalized = locale.trim().replace("_", "-");
  return normalized || "en";
}

export const isChineseTarget = (target: TranslationTargetLanguage | string, locale: string) =>
  resolveTargetLanguage(target, locale).toLowerCase().startsWith("zh");

/** Fold regional variants and legacy codes onto the family used for comparison. */
export function languageFamily(language: string) {
  const primary = language.toLowerCase().replace("_", "-").split("-")[0] ?? language;
  if (primary === "cmn" || primary === "yue" || primary === "zh") return "zh";
  if (primary === "nb" || primary === "nn") return "no";
  if (primary === "tl") return "fil";
  if (primary === "iw") return "he";
  if (primary === "in") return "id";
  return primary;
}

const LATIN_WORDS: Record<string, readonly string[]> = {
  en: ["the", "and", "you", "i", "to", "of", "is", "in", "that", "it", "my", "me", "we", "your", "don't"],
  es: ["el", "la", "de", "que", "y", "en", "un", "por", "con", "para", "mi", "te", "no", "los"],
  fr: ["le", "la", "de", "et", "un", "une", "que", "les", "des", "je", "tu", "nous", "pas", "dans"],
  de: ["der", "die", "das", "und", "ich", "du", "nicht", "ein", "eine", "mit", "für", "auf", "wir"],
  pt: ["o", "a", "de", "que", "e", "um", "uma", "não", "para", "com", "meu", "você", "os"],
  it: ["il", "la", "di", "che", "e", "un", "una", "non", "per", "con", "mio", "tu", "gli"],
  nl: ["de", "het", "een", "en", "ik", "jij", "niet", "van", "met", "voor", "wij"],
  tr: ["bir", "ve", "bu", "sen", "ben", "için", "ile", "değil", "ama"],
  vi: ["và", "của", "là", "không", "em", "anh", "tôi", "những", "một", "cho"],
  sv: ["och", "det", "att", "jag", "du", "inte", "en", "ett", "med", "för"],
  no: ["og", "det", "at", "jeg", "du", "ikke", "en", "et", "med", "for"],
  da: ["og", "det", "at", "jeg", "du", "ikke", "en", "et", "med", "for"],
  fi: ["ja", "on", "ei", "se", "minä", "sinä", "että", "kun"],
  pl: ["i", "w", "nie", "na", "się", "jest", "to", "że", "z", "do"],
  cs: ["a", "v", "se", "je", "na", "to", "že", "s", "do"],
  ro: ["și", "în", "nu", "este", "un", "o", "cu", "de", "la"],
  hu: ["a", "az", "és", "nem", "hogy", "van", "egy", "de"],
  id: ["yang", "dan", "di", "aku", "kamu", "tidak", "untuk", "dengan"],
  ms: ["yang", "dan", "di", "saya", "awak", "tidak", "untuk", "dengan"],
  fil: ["ang", "ng", "sa", "na", "ako", "ikaw", "hindi", "para"],
  sw: ["na", "ya", "ni", "kwa", "la", "wa", "si"],
};

const WORD_SETS = new Map(Object.entries(LATIN_WORDS).map(([language, words]) => [language, new Set(words)]));

const SCRIPT_RULES: readonly (readonly [RegExp, string])[] = [
  [/[\u3040-\u30ff\u31f0-\u31ff]/, "ja"], // kana: Japanese even when kanji are present
  [/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/, "ko"],
  [/[\u4e00-\u9fff]/, "zh"],
  [/[\u0e00-\u0e7f]/, "th"],
  [/[\u0980-\u09ff]/, "bn"],
  [/[\u0900-\u097f]/, "hi"],
  [/[\u0b80-\u0bff]/, "ta"],
  [/[\u0c00-\u0c7f]/, "te"],
  [/[\u0a80-\u0aff]/, "gu"],
  [/[\u0a00-\u0a7f]/, "pa"],
  [/[\u0d80-\u0dff]/, "si"],
  [/[\u0370-\u03ff]/, "el"],
  [/[\u0590-\u05ff]/, "he"],
];

function detectScript(text: string): string | null {
  for (const [pattern, language] of SCRIPT_RULES) if (pattern.test(text)) return language;
  if (/[\u0600-\u06ff]/.test(text)) {
    if (/[پچژگ]/.test(text)) return "fa";
    if (/[ٹڈڑںھہ]/.test(text)) return "ur";
    return "ar";
  }
  if (/[\u0400-\u04ff]/.test(text)) return /[іїєґ]/i.test(text) ? "uk" : "ru";
  return null;
}

function detectLatin(text: string): { language: string; hits: number } | null {
  const tokens = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (tokens.length === 0) return null;

  let best: { language: string; hits: number } | null = null;
  let second = 0;
  for (const [language, words] of WORD_SETS) {
    let hits = 0;
    for (const token of tokens) if (words.has(token)) hits += 1;
    if (hits > (best?.hits ?? 0)) {
      second = best?.hits ?? 0;
      best = { language, hits };
    } else if (hits > second) second = hits;
  }
  // One shared function word is noise; a clear lead over the runner-up is not.
  if (!best || best.hits < 3 || best.hits < second + 2) return null;
  return best;
}

export interface DetectedLanguage {
  language: string;
  accuracy: number;
}

/** The language of a set of lyric lines, or null when it is not clear enough to skip translation. */
export function detectLyricsLanguage(lines: readonly string[]): DetectedLanguage | null {
  const text = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  if (text.length < 24) return null;

  const script = detectScript(text);
  if (script) return { language: script, accuracy: 0.95 };

  const latin = detectLatin(text);
  if (latin) return { language: latin.language, accuracy: Math.min(0.9, 0.5 + latin.hits * 0.1) };
  return null;
}

/** The detected language when it is the requested one, so the lyrics need no translation. */
export function sourceLanguageMatchesTarget(lines: readonly string[], targetLanguage: string): DetectedLanguage | null {
  const detected = detectLyricsLanguage(lines);
  if (!detected) return null;
  return languageFamily(detected.language) === languageFamily(targetLanguage) ? detected : null;
}
