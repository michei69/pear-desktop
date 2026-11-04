import type { ProviderName } from './providers';
import type { SongInfo } from '@/providers/song-info';

export type TranslationProviderName =
  | 'openai-compatible'
  | 'anthropic'
  | 'gemini'
  | 'local-cli'
  | 'google-translate';

export type OpenAICompatibleApiMode = 'responses' | 'chat-completions' | 'auto';
export type LocalCliProviderEngine = 'claude' | 'codex' | 'gemini';

export type TranslationProviderSettings = {
  'openai-compatible': {
    baseUrl: string;
    apiKey: string;
    model: string;
    apiMode?: OpenAICompatibleApiMode;
  };
  'anthropic': { apiKey: string; model: string };
  'gemini': { apiKey: string; model: string };
  'local-cli': {
    engine: LocalCliProviderEngine;
    command?: string;
    model?: string;
    timeoutSeconds: number;
  };
  'google-translate': {
    host: string;
  };
};

export type TranslationTargetLanguage =
  | 'auto'
  | 'zh-CN'
  | 'zh-TW'
  | 'en'
  | 'ja'
  | 'ko'
  | 'fr'
  | 'de'
  | 'es'
  | 'pt-BR'
  | 'pt-PT'
  | 'it'
  | 'nl'
  | 'ru'
  | 'uk'
  | 'pl'
  | 'tr'
  | 'ar'
  | 'he'
  | 'fa'
  | 'hi'
  | 'bn'
  | 'ur'
  | 'ta'
  | 'te'
  | 'mr'
  | 'id'
  | 'ms'
  | 'vi'
  | 'th'
  | 'fil'
  | 'sw'
  | 'sv'
  | 'no'
  | 'da'
  | 'fi'
  | 'cs'
  | 'ro'
  | 'hu'
  | 'el'
  | 'bg'
  | 'sr'
  | 'hr'
  | 'sk'
  | 'lt';

export type TranslationConfig = {
  enabled: boolean;
  provider: TranslationProviderName;
  targetLanguage: TranslationTargetLanguage;
  providers: TranslationProviderSettings;
};

export type SyncedLyricsPluginConfig = {
  enabled: boolean;
  /**
   * Providers in the order they are tried, first hit winning. Absent means the
   * declared order — see the note on the plugin's config.
   */
  providerPriority?: ProviderName[];
  /**
   * Follow `providerPriority`. Off restores the old behaviour: best lyrics win,
   * the list only breaks ties.
   */
  usePriorityList: boolean;
  /** Prefer time-synced lyrics over plain ones while walking the order. */
  preferSynced: boolean;
  preciseTiming: boolean;
  showTimeCodes: boolean;
  defaultTextString: string | string[];
  showLyricsEvenIfInexact: boolean;
  lineEffect: LineEffect;
  /**
   * Which renderer draws the lyrics: the plugin's own line list, or the
   * am-lyrics component in Apple Music style.
   */
  lyricsStyle: LyricsStyle;
  lyricsFontSize?: LyricsFontSize;
  romanization: boolean;
  useYTMLyricsWithoutProxy: boolean;
  convertChineseCharacter?:
    | 'simplifiedToTraditional'
    | 'traditionalToSimplified'
    | 'disabled';
  showCustomSearchButton?: boolean;
  translation: TranslationConfig;
};

export type LineLyricsStatus = 'previous' | 'current' | 'upcoming';

/**
 * One timed word (or syllable) inside a synced line. `text` keeps the trailing
 * space of the source so a word-by-word renderer can lay the line out without
 * re-splitting it.
 */
export type LyricWord = {
  text: string;
  timeInMs: number;
  duration: number;
};

export type LineLyrics = {
  time: string;
  timeInMs: number;
  duration: number;

  text: string;
  status: LineLyricsStatus;

  /** Word/syllable timings: enhanced LRC `<mm:ss.xx>` or TTML spans. */
  words?: LyricWord[];
  /** Timings of the background vocals sung over this line. */
  background?: LyricWord[];
  /** Duet line alignment: right-aligned when the other singer takes over. */
  alignment?: 'start' | 'end';
  /** Right-to-left line, so the karaoke fill runs right-to-left. */
  rtl?: boolean;
};

export type LineEffect = 'fancy' | 'scale' | 'offset' | 'focus';
export type LyricsFontSize = 'small' | 'medium' | 'large';

/** Which renderer draws the lyrics: the plugin's own, or am-lyrics. */
export type LyricsStyle = 'standard' | 'apple-music';

export interface LyricResult {
  title: string;
  artists: string[];

  lyrics?: string;
  lines?: LineLyrics[];
  translation?: {
    lyrics?: string;
    lines?: LineLyrics[];
    language?: string;
    provider?: string;
  };
}

// prettier-ignore
export type SearchSongInfo = Pick<SongInfo, 'title' | 'alternativeTitle' | 'artist' | 'album' | 'songDuration' | 'videoId' | 'tags'>;

export interface LyricProvider {
  name: string;
  baseUrl: string;

  search(songInfo: SearchSongInfo): Promise<LyricResult | null>;
}
