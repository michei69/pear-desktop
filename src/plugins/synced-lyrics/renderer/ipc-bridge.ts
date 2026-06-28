import type { TranslationRequest } from '../translation/types';
import type {
  TranslationProviderName,
  TranslationProviderSettings,
} from '../types';

export interface TranslateInvokeArgs {
  videoId: string;
  request: TranslationRequest;
  provider: TranslationProviderName;
  settings: TranslationProviderSettings[TranslationProviderName];
}

export let netFetch: (
  url: string,
  init?: RequestInit,
) => Promise<[number, string, Record<string, string>]>;

export function setNetFetch(fn: typeof netFetch) {
  netFetch = fn;
}

export let translateInvoke: (
  args: TranslateInvokeArgs,
) => Promise<{ lines: string[]; fromCache: boolean; error?: string }>;

export function setTranslateInvoke(fn: typeof translateInvoke) {
  translateInvoke = fn;
}
