import i18next, { init, t as i18t, changeLanguage } from 'i18next';
import { loadLanguageResources } from 'virtual:i18n';

import type { LanguageResources } from '@/i18n/resources/@types';

export const APPLICATION_NAME = 'Pear Desktop';

let loadedResources: LanguageResources = {};

export const loadI18n = async (language = 'en') => {
  const languages = [...new Set(['en', language])];
  loadedResources = await loadLanguageResources(languages);

  await init({
    resources: loadedResources,
    lng: language,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });
};

/**
 * The resources loaded at startup. Preload hands these to the injected
 * renderer, which has no translations of its own.
 */
export const getLoadedResources = () => loadedResources;

/**
 * Loads one language on demand, for a live switch that was not known at
 * startup. Resources already in memory are kept.
 */
export const loadLanguage = async (language: string) => {
  if (loadedResources[language]) return;

  const resources = await loadLanguageResources([language]);
  Object.assign(loadedResources, resources);

  for (const [lng, value] of Object.entries(resources)) {
    i18next.addResourceBundle(
      lng,
      'translation',
      value.translation,
      true,
      true,
    );
  }
};

export const setLanguage = async (language: string) =>
  await changeLanguage(language);

export const t = i18t.bind(i18next);
