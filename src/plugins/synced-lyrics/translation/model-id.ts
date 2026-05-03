import { normalizeGoogleTranslateHost } from './providers/google-translate-host';

import type {
  TranslationProviderName,
  TranslationProviderSettings,
} from '../types';

export const getTranslationModelId = (
  provider: TranslationProviderName,
  settings: TranslationProviderSettings[TranslationProviderName],
): string => {
  if (provider === 'local-cli') {
    const local = settings as TranslationProviderSettings['local-cli'];
    return `${local.engine}:auto`;
  }

  if (provider === 'google-translate') {
    const google = settings as TranslationProviderSettings['google-translate'];
    return `google-translate:${normalizeGoogleTranslateHost(google.host)}`;
  }

  return (settings as { model?: string }).model ?? '';
};
