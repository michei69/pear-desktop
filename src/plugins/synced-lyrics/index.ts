import style from './style.css?inline';
import { createPlugin } from '@/utils';
import { t } from '@/i18n';

import { menu } from './menu';
import { renderer } from './renderer';
import { backend } from './backend';

import type { SyncedLyricsPluginConfig } from './types';

export default createPlugin({
  name: () => t('plugins.synced-lyrics.name'),
  description: () => t('plugins.synced-lyrics.description'),
  authors: ['Non0reo', 'ArjixWasTaken', 'KimJammer', 'Strvm'],
  restartNeeded: true,
  addedVersion: '3.5.X',
  config: {
    enabled: false,
    preciseTiming: true,
    showLyricsEvenIfInexact: true,
    showTimeCodes: false,
    defaultTextString: '♪',
    lineEffect: 'fancy',
    lyricsFontSize: 'small',
    romanization: true,
    translation: {
      enabled: false,
      provider: 'openai-compatible',
      targetLanguage: 'auto',
      providers: {
        'openai-compatible': {
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-4o-mini',
          apiMode: 'auto',
        },
        'anthropic': {
          apiKey: '',
          model: 'claude-haiku-4-5-20251001',
        },
        'gemini': {
          apiKey: '',
          model: 'gemini-2.0-flash',
        },
        'local-cli': {
          engine: 'claude',
          command: '',
          model: '',
          timeoutSeconds: 120,
        },
        'google-translate': {
          host: 'translate.google.com',
        },
      },
    },
    useYTMLyricsWithoutProxy: false,
  } satisfies SyncedLyricsPluginConfig as SyncedLyricsPluginConfig,

  menu,
  renderer,
  backend,
  stylesheets: [style],
});
