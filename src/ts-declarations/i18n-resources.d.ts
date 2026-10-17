import type { LanguageResources } from '@/i18n/resources/@types';

declare global {
  /** Translation resources preload hands to the injected renderer. */
  var __PEAR_I18N_RESOURCES__: LanguageResources | undefined;
}

export {};
