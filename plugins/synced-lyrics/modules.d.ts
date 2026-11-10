/** The component registers its `<am-lyrics>` element on import; no exports are used. */
declare module "@uimaxbai/am-lyrics/am-lyrics.js";

declare module "kuroshiro" {
  export default class Kuroshiro {
    static Util: {
      kanaToRomaji(text: string, mode?: "hepburn" | "passport"): string;
      isKana(text: string): boolean;
      hasKana(text: string): boolean;
    };
    init(analyzer: unknown): Promise<void>;
    convert(text: string, options: { to: "romaji" | "hiragana" | "katakana"; mode?: string }): Promise<string>;
  }
}

declare module "kuroshiro-analyzer-kuromoji" {
  export default class KuromojiAnalyzer {
    constructor(options?: { dictPath?: string });
  }
}
