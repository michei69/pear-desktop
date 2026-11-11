// Host side: romanization and Chinese script conversion. Everything is loaded
// lazily with dynamic imports, so it costs nothing until a song needs it, and
// none of it ever reaches the page bundle.

import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const KANA = /[぀-ヿㇰ-ㇿｦ-ﾟ]/;
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
const HAN = /[㐀-䶿一-鿿豈-﫿]/;
const HAN_RUN = /[㐀-䶿一-鿿豈-﫿]+/g;

// pear-desktop's other scripts (Unicode blocks).
const THAI = /[\u0E00-\u0E7F]/;
const BENGALI = /[\u0980-\u09FF]/;
const DEVANAGARI = /[\u0900-\u097F]/;

export type Script = "ja" | "ko" | "zh" | "th" | "bn" | "hi";

/**
 * Per line, except for kanji: decided per song, since a kanji-only line in a
 * Japanese song is Japanese, not Chinese (per-line guessing is how
 * romanization regressed upstream). Thai, Bengali and Devanagari (Hindi) are
 * unambiguous per line, as pear-desktop romanized them.
 */
export function detectScripts(lines: readonly string[]): (Script | null)[] {
  const japanese = lines.some((line) => KANA.test(line));
  return lines.map((line) => {
    if (HANGUL.test(line)) return "ko";
    if (KANA.test(line) || (japanese && HAN.test(line))) return "ja";
    if (HAN.test(line)) return "zh";
    if (THAI.test(line)) return "th";
    if (BENGALI.test(line)) return "bn";
    if (DEVANAGARI.test(line)) return "hi";
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
  convert(text: string, options: { to: "romaji"; mode: "spaced" }): Promise<string>;
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

  /** `dictDir` caches the Japanese dictionary (~17 MB, downloaded on first use). */
  constructor(dictDir: string, fetch: (url: string) => Promise<Response>) {
    this.#dictDir = dictDir;
    this.#fetch = fetch;
  }

  async romanize(lines: readonly string[]): Promise<(string | null)[]> {
    const scripts = detectScripts(lines);
    return Promise.all(
      lines.map(async (line, i) => {
        const script = scripts[i];
        if (!script) return null;
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
      case "th":
        return romanizeThai(line);
      case "bn":
        return romanizeIndic(line, "bengali");
      case "hi":
        return romanizeIndic(line, "devanagari");
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
async function romanizeIndic(line: string, scheme: "bengali" | "devanagari") {
  const Sanscript = defaultExport(await import("@indic-transliteration/sanscript")) as {
    t(text: string, from: string, to: string): string;
  };
  try {
    const out = Sanscript.t(line, scheme, "iast")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    return scheme === "bengali" ? out.replace(/[\u09BC\u09BE-\u09CD]/g, "").toLowerCase() : out.replace(/[^a-zA-Z\s]/g, "") || line;
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
