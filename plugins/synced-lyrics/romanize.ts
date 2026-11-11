// Host side: romanization and Chinese script conversion. Everything is loaded
// lazily with dynamic imports, so it costs nothing until a song needs it, and
// none of it ever reaches the page bundle.

import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROMANIZATION_SCRIPTS, type RomanizationScript } from "./types.ts";

const KANA = /[぀-ヿㇰ-ㇿｦ-ﾟ]/;
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
const HAN = /[㐀-䶿一-鿿豈-﫿]/;
const HAN_RUN = /[㐀-䶿一-鿿豈-﫿]+/g;

// pear-desktop's other scripts (Unicode blocks).
const THAI = /[\u0E00-\u0E7F]/;
const BENGALI = /[\u0980-\u09FF]/;
const DEVANAGARI = /[\u0900-\u097F]/;
const ARABIC = /\p{Script=Arabic}/u;
const PERSIAN = /[پچژگک]/;
const URDU = /[ٹڈڑںھہےۓ]/;
const HEBREW = /\p{Script=Hebrew}/u;
const GREEK = /\p{Script=Greek}/u;
const ARMENIAN = /\p{Script=Armenian}/u;
const GEORGIAN = /\p{Script=Georgian}/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;
const TAMIL = /\p{Script=Tamil}/u;
const TELUGU = /\p{Script=Telugu}/u;
const KANNADA = /\p{Script=Kannada}/u;
const MALAYALAM = /\p{Script=Malayalam}/u;
const GUJARATI = /\p{Script=Gujarati}/u;
const GURMUKHI = /\p{Script=Gurmukhi}/u;
const ORIYA = /\p{Script=Oriya}/u;

export type Script = RomanizationScript;

/**
 * Per line, except for kanji: decided per song, since a kanji-only line in a
 * Japanese song is Japanese, not Chinese (per-line guessing is how
 * romanization regressed upstream). Unequal scripts are unambiguous per line.
 */
export function detectScripts(lines: readonly string[]): (Script | null)[] {
  const japanese = lines.some((line) => KANA.test(line));
  return lines.map((line) => {
    if (HANGUL.test(line)) return "ko";
    if (KANA.test(line) || (japanese && HAN.test(line))) return "ja";
    if (HAN.test(line)) return "zh";
    if (ARABIC.test(line)) return URDU.test(line) ? "ur" : PERSIAN.test(line) ? "fa" : "ar";
    if (HEBREW.test(line)) return "he";
    if (GREEK.test(line)) return "el";
    if (ARMENIAN.test(line)) return "hy";
    if (GEORGIAN.test(line)) return "ka";
    if (CYRILLIC.test(line)) return "ru";
    if (THAI.test(line)) return "th";
    if (BENGALI.test(line)) return "bn";
    if (DEVANAGARI.test(line)) return "hi";
    if (TAMIL.test(line)) return "ta";
    if (TELUGU.test(line)) return "te";
    if (KANNADA.test(line)) return "kn";
    if (MALAYALAM.test(line)) return "ml";
    if (GUJARATI.test(line)) return "gu";
    if (GURMUKHI.test(line)) return "pa";
    if (ORIYA.test(line)) return "or";
    return null;
  });
}

const KUROMOJI_DICT = "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/";
const DICT_FILES = [
  "base.dat.gz",
  "cc.dat.gz",
  "check.dat.gz",
  "tid.dat.gz",
  "tid_map.dat.gz",
  "tid_pos.dat.gz",
  "unk.dat.gz",
  "unk_char.dat.gz",
  "unk_compat.dat.gz",
  "unk_invoke.dat.gz",
  "unk_map.dat.gz",
  "unk_pos.dat.gz",
];

interface KuroshiroInstance {
  convert(text: string, options: { to: "romaji" | "hiragana" | "katakana"; mode?: "normal" | "spaced" }): Promise<string>;
}

interface JapaneseToken {
  surface_form: string;
  verbose?: { word_type?: string };
}

interface KuromojiAnalyzer {
  parse(text: string): Promise<JapaneseToken[]>;
}

interface JapaneseEngine {
  kuroshiro: KuroshiroInstance;
  analyzer: KuromojiAnalyzer;
}

/** Conversion is pure per line, so repeated lines (choruses, revisits) are paid once. */
const LINE_CACHE_LIMIT = 1024;

function cacheLine<T>(cache: Map<string, T>, key: string, value: T) {
  if (cache.size >= LINE_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
}

export class Romanizer {
  #dictDir: string;
  #fetch: (url: string) => Promise<Response>;
  #japanese: Promise<JapaneseEngine> | undefined;
  /** Per line and script: the song's script detection decides how a kanji line reads. */
  #memo = new Map<string, string | null>();
  /** Per line and kana target: Japanese script conversion. */
  #kana = new Map<string, string>();

  /** `dictDir` caches the Japanese dictionary (~17 MB, downloaded on first use). */
  constructor(dictDir: string, fetch: (url: string) => Promise<Response>) {
    this.#dictDir = dictDir;
    this.#fetch = fetch;
  }

  async romanize(lines: readonly string[], enabled: readonly RomanizationScript[] = ROMANIZATION_SCRIPTS): Promise<(string | null)[]> {
    const allowed = new Set(enabled);
    const scripts = detectScripts(lines);
    return Promise.all(
      lines.map(async (line, i) => {
        const script = scripts[i];
        if (!script || !allowed.has(script)) return null;
        const key = `${script}\n${line}`;
        const cached = this.#memo.get(key);
        if (cached !== undefined) return cached;
        const result = tidy(await this.#line(line, script));
        const value = result && result.toLowerCase() !== line.trim().toLowerCase() ? result : null;
        cacheLine(this.#memo, key, value);
        return value;
      }),
    );
  }

  /** Replaces kanji with Kuroshiro's reading; timings are the caller's business. */
  async convertJapanese(lines: readonly string[], mode: "hiragana" | "katakana"): Promise<string[]> {
    const engine = await (this.#japanese ??= this.#loadKuroshiro().catch((error: unknown) => {
      this.#japanese = undefined;
      throw error;
    }));
    return Promise.all(
      lines.map(async (line) => {
        if (!line) return line;
        const key = `${mode}\n${line}`;
        const cached = this.#kana.get(key);
        if (cached !== undefined) return cached;
        const converted = await engine.kuroshiro.convert(line, { to: mode, mode: "normal" });
        cacheLine(this.#kana, key, converted);
        return converted;
      }),
    );
  }

  async #line(line: string, script: Script) {
    switch (script) {
      case "ko": {
        const [{ romanize }, hanja] = await Promise.all([import("es-hangul"), import("hanja")]);
        const translate = (hanja.default ?? hanja).translate;
        return romanize(translate(line, "SUBSTITUTION"));
      }
      case "zh": {
        const { pinyin } = await import("pinyin-pro");
        return line.replace(HAN_RUN, (run) => ` ${pinyin(run, { separator: " " })} `);
      }
      case "ja": {
        const engine = await (this.#japanese ??= this.#loadKuroshiro().catch((error: unknown) => {
          this.#japanese = undefined;
          throw error;
        }));
        return romanizeJapaneseLine(line, engine);
      }
      case "ar":
      case "fa":
      case "ur":
      case "he":
      case "el":
      case "hy":
      case "ka":
      case "ru": {
        const anyAscii = defaultExport(await import("any-ascii"));
        return anyAscii(line);
      }
      case "th":
        return romanizeThai(line);
      case "bn":
        return romanizeIndic(line, "bengali");
      case "hi":
        return romanizeIndic(line, "devanagari");
      case "ta":
        return romanizeIndic(line, "tamil");
      case "te":
        return romanizeIndic(line, "telugu");
      case "kn":
        return romanizeIndic(line, "kannada");
      case "ml":
        return romanizeIndic(line, "malayalam");
      case "gu":
        return romanizeIndic(line, "gujarati");
      case "pa":
        return romanizeIndic(line, "gurmukhi");
      case "or":
        return romanizeIndic(line, "oriya");
    }
  }

  async #loadKuroshiro(): Promise<JapaneseEngine> {
    await this.#ensureDictionary();
    const [kuroshiroModule, analyzerModule] = await Promise.all([import("kuroshiro"), import("kuroshiro-analyzer-kuromoji")]);
    const Kuroshiro = defaultExport(kuroshiroModule);
    const Analyzer = defaultExport(analyzerModule);
    const analyzer = new Analyzer({ dictPath: `${this.#dictDir}/` });
    const kuroshiro = new Kuroshiro();
    await kuroshiro.init(analyzer);
    return { kuroshiro, analyzer };
  }

  async #ensureDictionary() {
    await mkdir(this.#dictDir, { recursive: true });
    await Promise.all(
      DICT_FILES.map(async (file) => {
        const target = join(this.#dictDir, file);
        if (existsSync(target)) return;
        const response = await this.#fetch(`${KUROMOJI_DICT}${file}`);
        if (!response.ok) throw new Error(`dictionary download failed: ${file} (${response.status})`);
        const temporary = `${target}.part`;
        await writeFile(temporary, Buffer.from(await response.arrayBuffer()));
        await rename(temporary, target);
      }),
    );
  }
}

/**
 * Kuromoji knows Japanese kanji, not Chinese variants such as 夺 (the Japanese
 * form is 奪). Replace only tokens the analyzer marks UNKNOWN before the full
 * line is converted, so the surrounding words still provide context. The
 * simplified-to-traditional table is the same one the Chinese converter uses.
 */
export async function prepareJapaneseLine(line: string, analyzer: KuromojiAnalyzer, tify: (text: string) => string): Promise<string> {
  if (!HAN.test(line)) return line;
  const tokens = await analyzer.parse(line);
  if (!tokens.some((token) => HAN.test(token.surface_form) && token.verbose?.word_type === "UNKNOWN")) return line;
  return tokens
    .map((token) =>
      HAN.test(token.surface_form) && token.verbose?.word_type === "UNKNOWN" ? tify(token.surface_form) : token.surface_form,
    )
    .join("");
}

/**
 * Kuroshiro leaves glyphs with no dictionary reading in the output. Try their
 * traditional/Japanese form first; a glyph that is still unknown falls back to
 * pinyin, so a Japanese line never keeps an unreadable Han character.
 */
export async function fillUnknownJapanese(
  text: string,
  convert: (text: string) => Promise<string>,
  tify: (text: string) => string,
  pinyin: (text: string) => string,
): Promise<string> {
  if (!HAN.test(text)) return text;
  const runs = [...text.matchAll(HAN_RUN)].map((match) => match[0]);
  const replacements = await Promise.all(
    runs.map(async (run) => {
      const traditional = tify(run);
      if (traditional !== run) {
        const converted = await convert(traditional);
        if (!HAN.test(converted)) return converted;
      }
      const latin = pinyin(run);
      return HAN.test(latin) ? run : latin;
    }),
  );
  let index = 0;
  return text.replace(HAN_RUN, () => replacements[index++] ?? "");
}

async function romanizeJapaneseLine(line: string, engine: JapaneseEngine) {
  const convert = (text: string) => engine.kuroshiro.convert(text, { to: "romaji", mode: "spaced" });
  const { tify } = await import("chinese-conv");
  const prepared = await prepareJapaneseLine(line, engine.analyzer, tify);
  const romanized = await convert(prepared);
  if (!HAN.test(romanized)) return romanized;
  const { pinyin } = await import("pinyin-pro");
  return fillUnknownJapanese(romanized, convert, tify, (run) => pinyin(run, { separator: " ", toneType: "none" }));
}

/** pear-desktop's Thai romanization: word by word where the platform can segment Thai. */
async function romanizeThai(line: string) {
  const { romanize } = await import("@dehoist/romanize-thai");
  const segmenter = Intl.Segmenter.supportedLocalesOf("th").includes("th") ? new Intl.Segmenter("th", { granularity: "word" }) : null;
  if (!segmenter) return romanize(line);
  return Array.from(segmenter.segment(line), (segment) => (segment.isWordLike ? romanize(segment.segment) : segment.segment.trim()))
    .join(" ")
    .trim();
}

/** pear-desktop's Bengali and Hindi romanization: IAST through Sanscript, without the accents. */
async function romanizeIndic(
  line: string,
  scheme: "bengali" | "devanagari" | "tamil" | "telugu" | "kannada" | "malayalam" | "gujarati" | "gurmukhi" | "oriya",
) {
  const Sanscript = defaultExport(await import("@indic-transliteration/sanscript")) as {
    t(text: string, from: string, to: string): string;
  };
  try {
    const out = Sanscript.t(line, scheme, "iast")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return out.replace(/[^a-zA-Z\s]/g, "").toLowerCase() || line;
  } catch {
    return line;
  }
}

const chineseCache = new Map<string, string>();

export async function convertChinese(lines: readonly string[], mode: "s2t" | "t2s") {
  const { sify, tify } = await import("chinese-conv");
  return lines.map((line) => {
    if (!HAN.test(line)) return line;
    const key = `${mode}\n${line}`;
    const cached = chineseCache.get(key);
    if (cached !== undefined) return cached;
    const converted = mode === "s2t" ? tify(line) : sify(line);
    cacheLine(chineseCache, key, converted);
    return converted;
  });
}

function tidy(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:)\]」』])/g, "$1")
    .replace(/([([「『])\s+/g, "$1")
    .trim();
}

function defaultExport(module: any): any {
  return module?.default?.default ?? module?.default ?? module;
}
