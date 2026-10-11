import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './backend';
import { menu } from './menu';
import { providerNames } from './providers';
import { renderer } from './renderer';
import style from './style.css?inline';

import type {
  LyricsFontSize,
  SyncedLyricsPluginConfig,
  TranslationProviderName,
  TranslationTargetLanguage,
} from './types';

const lyricsFontSizeOptions: LyricsFontSize[] = ['small', 'medium', 'large'];

const translateProviderOptions: TranslationProviderName[] = [
  'openai-compatible',
  'anthropic',
  'gemini',
  'local-cli',
  'google-translate',
];

const translateTargetLanguageOptions: TranslationTargetLanguage[] = [
  'auto',
  'zh-CN',
  'zh-TW',
  'en',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'pt-BR',
  'pt-PT',
  'it',
  'nl',
  'ru',
  'uk',
  'pl',
  'tr',
  'ar',
  'he',
  'fa',
  'hi',
  'bn',
  'ur',
  'ta',
  'te',
  'mr',
  'id',
  'ms',
  'vi',
  'th',
  'fil',
  'sw',
  'sv',
  'no',
  'da',
  'fi',
  'cs',
  'ro',
  'hu',
  'el',
  'bg',
  'sr',
  'hr',
  'sk',
  'lt',
];

export default createPlugin<
  typeof backend,
  unknown,
  typeof renderer,
  SyncedLyricsPluginConfig
>({
  name: () => t('plugins.synced-lyrics.name'),
  description: () => t('plugins.synced-lyrics.description'),
  authors: ['Non0reo', 'ArjixWasTaken', 'KimJammer', 'Strvm'],
  restartNeeded: true,
  addedVersion: '3.5.X',
  config: {
    enabled: false,
    // No default for `providerPriority`: deepmerge concatenates arrays, so a
    // default order would be prepended to the stored one on every read. Absent
    // means the declared order; the 3.12.3 migration turns this on for a legacy
    // `preferredProvider`.
    usePriorityList: false,
    preferSynced: true,
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
    showCustomSearchButton: true,
  } satisfies SyncedLyricsPluginConfig as SyncedLyricsPluginConfig,

  settings: [
    {
      fields: [
        {
          type: 'switch',
          key: 'usePriorityList',
          label: () => t('plugins.synced-lyrics.settings.use-priority-list'),
          description: () =>
            t('plugins.synced-lyrics.menu.use-priority-list.tooltip'),
        },
        {
          type: 'orderable',
          key: 'providerPriority',
          label: () => t('plugins.synced-lyrics.settings.provider-priority'),
          description: () =>
            t('plugins.synced-lyrics.menu.provider-priority.tooltip'),
          options: providerNames.map((provider) => ({
            value: provider,
            label: () => provider,
          })),
        },
        {
          type: 'switch',
          key: 'preferSynced',
          label: () => t('plugins.synced-lyrics.settings.prefer-synced'),
          description: () =>
            t('plugins.synced-lyrics.menu.prefer-synced.tooltip'),
        },
        {
          type: 'switch',
          key: 'preciseTiming',
          label: () => t('plugins.synced-lyrics.settings.precise-timing'),
          description: () =>
            t('plugins.synced-lyrics.menu.precise-timing.tooltip'),
        },
        {
          type: 'switch',
          key: 'showLyricsEvenIfInexact',
          label: () => t('plugins.synced-lyrics.settings.show-inexact'),
          description: () =>
            t('plugins.synced-lyrics.menu.show-lyrics-even-if-inexact.tooltip'),
        },
        {
          type: 'switch',
          key: 'showTimeCodes',
          label: () => t('plugins.synced-lyrics.settings.show-time-codes'),
        },
        {
          type: 'switch',
          key: 'romanization',
          label: () => t('plugins.synced-lyrics.settings.romanization'),
          description: () =>
            t('plugins.synced-lyrics.menu.romanization.tooltip'),
        },
        {
          type: 'select',
          key: 'lineEffect',
          label: () => t('plugins.synced-lyrics.settings.line-effect'),
          description: () =>
            t('plugins.synced-lyrics.menu.line-effect.tooltip'),
          options: [
            {
              value: 'fancy',
              label: () => t('plugins.synced-lyrics.settings.effect.fancy'),
            },
            {
              value: 'scale',
              label: () => t('plugins.synced-lyrics.settings.effect.scale'),
            },
            {
              value: 'offset',
              label: () => t('plugins.synced-lyrics.settings.effect.offset'),
            },
            {
              value: 'focus',
              label: () => t('plugins.synced-lyrics.settings.effect.focus'),
            },
          ],
        },
        {
          type: 'select',
          variant: 'dropdown',
          key: 'lyricsFontSize',
          label: () => t('plugins.synced-lyrics.menu.lyrics-font-size.label'),
          description: () =>
            t('plugins.synced-lyrics.menu.lyrics-font-size.tooltip'),
          options: lyricsFontSizeOptions.map((size) => ({
            value: size,
            label: () =>
              t(
                `plugins.synced-lyrics.menu.lyrics-font-size.submenu.${size}.label`,
              ),
          })),
        },
        {
          type: 'select',
          variant: 'dropdown',
          key: 'convertChineseCharacter',
          label: () =>
            t('plugins.synced-lyrics.menu.convert-chinese-character.label'),
          description: () =>
            t('plugins.synced-lyrics.menu.convert-chinese-character.tooltip'),
          options: [
            {
              value: 'disabled',
              label: () =>
                t(
                  'plugins.synced-lyrics.menu.convert-chinese-character.submenu.disabled.label',
                ),
            },
            {
              value: 'simplifiedToTraditional',
              label: () =>
                t(
                  'plugins.synced-lyrics.menu.convert-chinese-character.submenu.simplified-to-traditional.label',
                ),
            },
            {
              value: 'traditionalToSimplified',
              label: () =>
                t(
                  'plugins.synced-lyrics.menu.convert-chinese-character.submenu.traditional-to-simplified.label',
                ),
            },
          ],
        },
        {
          type: 'text',
          key: 'defaultTextString',
          label: () =>
            t('plugins.synced-lyrics.menu.default-text-string.label'),
          description: () =>
            t('plugins.synced-lyrics.menu.default-text-string.tooltip'),
          placeholder: () => '♪',
        },
        {
          type: 'switch',
          key: 'useYTMLyricsWithoutProxy',
          label: () =>
            t('plugins.synced-lyrics.menu.use-ytm-lyrics-without-proxy.label'),
          description: () =>
            t(
              'plugins.synced-lyrics.menu.use-ytm-lyrics-without-proxy.tooltip',
            ),
        },
        {
          type: 'switch',
          key: 'showCustomSearchButton',
          label: () =>
            t('plugins.synced-lyrics.menu.show-custom-search-button.label'),
          description: () =>
            t('plugins.synced-lyrics.menu.show-custom-search-button.tooltip'),
        },
      ],
    },
    {
      title: () => t('plugins.synced-lyrics.menu.translation.label'),
      fields: [
        {
          type: 'switch',
          key: 'translation.enabled',
          label: () =>
            t('plugins.synced-lyrics.menu.translation.enabled.label'),
          description: () =>
            t('plugins.synced-lyrics.menu.translation.enabled.tooltip'),
        },
        {
          type: 'select',
          variant: 'dropdown',
          key: 'translation.provider',
          label: () =>
            t('plugins.synced-lyrics.menu.translation.provider.label'),
          description: () =>
            t('plugins.synced-lyrics.menu.translation.provider.tooltip'),
          options: translateProviderOptions.map((provider) => ({
            value: provider,
            label: () =>
              t(
                `plugins.synced-lyrics.menu.translation.providers.${provider}.name`,
              ),
          })),
        },
        {
          type: 'select',
          variant: 'dropdown',
          key: 'translation.targetLanguage',
          label: () =>
            t('plugins.synced-lyrics.menu.translation.target-language.label'),
          description: () =>
            t('plugins.synced-lyrics.menu.translation.target-language.tooltip'),
          options: translateTargetLanguageOptions.map((language) => ({
            value: language,
            label: () =>
              t(
                `plugins.synced-lyrics.menu.translation.target-language.options.${language}`,
              ),
          })),
        },
      ],
    },
    {
      title: () =>
        t(
          'plugins.synced-lyrics.menu.translation.providers.openai-compatible.name',
        ),
      fields: [
        {
          type: 'text',
          key: 'translation.providers.openai-compatible.baseUrl',
          label: () =>
            t(
              'plugins.synced-lyrics.menu.translation.providers.openai-compatible.base-url',
            ),
        },
        {
          type: 'text',
          key: 'translation.providers.openai-compatible.apiKey',
          label: () =>
            t(
              'plugins.synced-lyrics.menu.translation.providers.shared.api-key',
            ),
        },
        {
          type: 'text',
          key: 'translation.providers.openai-compatible.model',
          label: () =>
            t('plugins.synced-lyrics.menu.translation.providers.shared.model'),
        },
        {
          type: 'select',
          variant: 'dropdown',
          key: 'translation.providers.openai-compatible.apiMode',
          label: () =>
            t(
              'plugins.synced-lyrics.menu.translation.providers.openai-compatible.api-mode',
            ),
          options: (['responses', 'chat-completions', 'auto'] as const).map(
            (apiMode) => ({
              value: apiMode,
              label: () => apiMode,
            }),
          ),
        },
      ],
    },
    {
      title: () =>
        t('plugins.synced-lyrics.menu.translation.providers.anthropic.name'),
      fields: [
        {
          type: 'text',
          key: 'translation.providers.anthropic.apiKey',
          label: () =>
            t(
              'plugins.synced-lyrics.menu.translation.providers.shared.api-key',
            ),
        },
        {
          type: 'text',
          key: 'translation.providers.anthropic.model',
          label: () =>
            t('plugins.synced-lyrics.menu.translation.providers.shared.model'),
        },
      ],
    },
    {
      title: () =>
        t('plugins.synced-lyrics.menu.translation.providers.gemini.name'),
      fields: [
        {
          type: 'text',
          key: 'translation.providers.gemini.apiKey',
          label: () =>
            t(
              'plugins.synced-lyrics.menu.translation.providers.shared.api-key',
            ),
        },
        {
          type: 'text',
          key: 'translation.providers.gemini.model',
          label: () =>
            t('plugins.synced-lyrics.menu.translation.providers.shared.model'),
        },
      ],
    },
    {
      title: () =>
        t('plugins.synced-lyrics.menu.translation.providers.local-cli.name'),
      fields: [
        {
          type: 'select',
          variant: 'dropdown',
          key: 'translation.providers.local-cli.engine',
          label: () =>
            t(
              'plugins.synced-lyrics.menu.translation.providers.local-cli.engine',
            ),
          options: [
            {
              value: 'claude',
              label: () =>
                t(
                  'plugins.synced-lyrics.menu.translation.providers.local-cli.engine-claude',
                ),
            },
            {
              value: 'codex',
              label: () =>
                t(
                  'plugins.synced-lyrics.menu.translation.providers.local-cli.engine-codex',
                ),
            },
            {
              value: 'gemini',
              label: () =>
                t(
                  'plugins.synced-lyrics.menu.translation.providers.local-cli.engine-gemini',
                ),
            },
          ],
        },
        {
          type: 'number',
          key: 'translation.providers.local-cli.timeoutSeconds',
          label: () =>
            t(
              'plugins.synced-lyrics.menu.translation.providers.local-cli.timeout',
            ),
          min: 15,
          max: 600,
          step: 1,
          unit: 's',
        },
      ],
    },
    {
      title: () =>
        t(
          'plugins.synced-lyrics.menu.translation.providers.google-translate.name',
        ),
      fields: [
        {
          type: 'text',
          key: 'translation.providers.google-translate.host',
          label: () =>
            t(
              'plugins.synced-lyrics.menu.translation.providers.google-translate.host',
            ),
        },
      ],
    },
  ],

  menu,
  renderer,
  backend,
  stylesheets: [style],
});
