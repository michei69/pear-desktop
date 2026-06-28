import { anthropicProvider } from './anthropic';
import { geminiProvider } from './gemini';
import { googleTranslateProvider } from './google-translate';
import { localCliProvider } from './local-cli';
import { openAICompatibleProvider } from './openai-compatible';

import type { TranslationProviderName } from '../../types';
import type { TranslationProvider } from '../types';

export const translationProviders: Record<
  TranslationProviderName,
  TranslationProvider
> = {
  'openai-compatible': openAICompatibleProvider,
  'anthropic': anthropicProvider,
  'gemini': geminiProvider,
  'local-cli': localCliProvider,
  'google-translate': googleTranslateProvider,
};
