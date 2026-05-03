import type {
  TranslationProviderName,
  TranslationProviderSettings,
  TranslationTargetLanguage,
} from '../types';

export interface TranslationRequest {
  title: string;
  artists: string[];
  targetLanguage: TranslationTargetLanguage;
  resolvedTargetLanguage: string;
  lines: string[];
}

export interface TranslationResult {
  lines: string[];
}

export interface TranslationProvider {
  name: TranslationProviderName;
  translate(
    req: TranslationRequest,
    settings: TranslationProviderSettings[TranslationProviderName],
  ): Promise<string[]>;
}

export interface TranslateInvokeArgs {
  cacheKey: string;
  request: TranslationRequest;
  provider: TranslationProviderName;
  settings: TranslationProviderSettings[TranslationProviderName];
}

export interface CacheEntry {
  key: string;
  strategyVersion: string;
  title: string;
  artists: string[];
  targetLanguage: string;
  provider: string;
  model: string;
  sourceHash: string;
  sourceLines: string[];
  createdAt: number;
  lines: string[];
}
