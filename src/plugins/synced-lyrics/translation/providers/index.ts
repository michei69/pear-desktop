import { openAICompatibleProvider } from './openai-compatible';
import { anthropicProvider } from './anthropic';
import { geminiProvider } from './gemini';
import { localCliProvider } from './local-cli';
import { googleTranslateProvider } from './google-translate';

import type { TranslationProvider } from '../types';
import type { TranslationProviderName } from '../../types';

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
