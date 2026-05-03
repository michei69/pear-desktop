import type { SongInfo } from '@/providers/song-info';
import type { ProviderName } from './providers';

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
  preferredProvider?: ProviderName;
  preciseTiming: boolean;
  showTimeCodes: boolean;
  defaultTextString: string | string[];
  showLyricsEvenIfInexact: boolean;
  lineEffect: LineEffect;
  lyricsFontSize?: LyricsFontSize;
  romanization: boolean;
  convertChineseCharacter?:
    | 'simplifiedToTraditional'
    | 'traditionalToSimplified'
    | 'disabled';
  translation: TranslationConfig;
};

export type LineLyricsStatus = 'previous' | 'current' | 'upcoming';

export type LineLyrics = {
  time: string;
  timeInMs: number;
  duration: number;

  text: string;
  status: LineLyricsStatus;
};

export type LineEffect = 'fancy' | 'scale' | 'offset' | 'focus';
export type LyricsFontSize = 'small' | 'medium' | 'large';

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
