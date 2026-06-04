import prompt from 'custom-electron-prompt';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';

import { providerNames } from './providers';
import { clearCache as clearTranslationCache } from './translation/cache';
import { normalizeGoogleTranslateHost } from './translation/providers/google-translate-host';

import type { MenuItemConstructorOptions } from 'electron';
import type { MenuContext } from '@/types/contexts';
import type {
  LocalCliProviderEngine,
  LyricsFontSize,
  OpenAICompatibleApiMode,
  SyncedLyricsPluginConfig,
  TranslationConfig,
  TranslationProviderName,
  TranslationTargetLanguage,
} from './types';

const targetLanguageOptions: TranslationTargetLanguage[] = [
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

const providerOrder: TranslationProviderName[] = [
  'openai-compatible',
  'anthropic',
  'gemini',
  'local-cli',
  'google-translate',
];

const lyricsFontSizeOptions: LyricsFontSize[] = ['small', 'medium', 'large'];

const normalizeApiMode = (value: string): OpenAICompatibleApiMode => {
  if (value === 'responses' || value === 'chat-completions') return value;
  if (value === 'auto') return value;
  return 'responses';
};

const normalizeLocalCliEngine = (value: string): LocalCliProviderEngine => {
  if (value === 'gemini') return 'gemini';
  if (value === 'codex') return 'codex';
  return 'claude';
};

const normalizeTimeoutSeconds = (value: string, fallback: number): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 15), 600);
};

const setTranslationConfig = async (
  ctx: MenuContext<SyncedLyricsPluginConfig>,
  updater: (translation: TranslationConfig) => TranslationConfig,
): Promise<void> => {
  const latest = await ctx.getConfig();
  await ctx.setConfig({
    translation: updater(latest.translation),
  });
  await ctx.refresh();
};

const promptProviderSettings = async (
  providerName: TranslationProviderName,
  ctx: MenuContext<SyncedLyricsPluginConfig>,
): Promise<void> => {
  const config = await ctx.getConfig();

  if (providerName === 'openai-compatible') {
    const current = config.translation.providers['openai-compatible'];
    const output = await prompt(
      {
        title: t(
          'plugins.synced-lyrics.menu.translation.providers.openai-compatible.prompt-title',
        ),
        label: t(
          'plugins.synced-lyrics.menu.translation.providers.openai-compatible.prompt-label',
        ),
        type: 'multiInput',
        multiInputOptions: [
          {
            label: t(
              'plugins.synced-lyrics.menu.translation.providers.openai-compatible.base-url',
            ),
            value: current.baseUrl,
            inputAttrs: { type: 'text' },
          },
          {
            label: t(
              'plugins.synced-lyrics.menu.translation.providers.shared.api-key',
            ),
            value: current.apiKey,
            inputAttrs: { type: 'password' },
          },
          {
            label: t(
              'plugins.synced-lyrics.menu.translation.providers.shared.model',
            ),
            value: current.model,
            inputAttrs: { type: 'text' },
          },
          {
            label: t(
              'plugins.synced-lyrics.menu.translation.providers.openai-compatible.api-mode',
            ),
            value: current.apiMode ?? 'responses',
            inputAttrs: { type: 'text' },
          },
        ],
        resizable: true,
        height: 430,
        ...promptOptions(),
      },
      ctx.window,
    );
    if (!output) return;
    await setTranslationConfig(ctx, (translation) => ({
      ...translation,
      providers: {
        ...translation.providers,
        'openai-compatible': {
          baseUrl: output[0] || current.baseUrl,
          apiKey: output[1] ?? current.apiKey,
          model: output[2] || current.model,
          apiMode: normalizeApiMode(output[3] || current.apiMode || ''),
        },
      },
    }));
    return;
  }

  if (providerName === 'anthropic' || providerName === 'gemini') {
    const current = config.translation.providers[providerName];
    const output = await prompt(
      {
        title: t(
          `plugins.synced-lyrics.menu.translation.providers.${providerName}.prompt-title`,
        ),
        label: t(
          `plugins.synced-lyrics.menu.translation.providers.${providerName}.prompt-label`,
        ),
        type: 'multiInput',
        multiInputOptions: [
          {
            label: t(
              'plugins.synced-lyrics.menu.translation.providers.shared.api-key',
            ),
            value: current.apiKey,
            inputAttrs: { type: 'password' },
          },
          {
            label: t(
              'plugins.synced-lyrics.menu.translation.providers.shared.model',
            ),
            value: current.model,
            inputAttrs: { type: 'text' },
          },
        ],
        resizable: true,
        height: 320,
        ...promptOptions(),
      },
      ctx.window,
    );
    if (!output) return;
    await setTranslationConfig(ctx, (translation) => ({
      ...translation,
      providers: {
        ...translation.providers,
        [providerName]: {
          apiKey: output[0] ?? current.apiKey,
          model: output[1] || current.model,
        },
      },
    }));
  }

  if (providerName === 'google-translate') {
    const current = config.translation.providers['google-translate'];
    const output = await prompt(
      {
        title: t(
          'plugins.synced-lyrics.menu.translation.providers.google-translate.prompt-title',
        ),
        label: t(
          'plugins.synced-lyrics.menu.translation.providers.google-translate.prompt-label',
        ),
        type: 'multiInput',
        multiInputOptions: [
          {
            label: t(
              'plugins.synced-lyrics.menu.translation.providers.google-translate.host',
            ),
            inputAttrs: { type: 'text' },
            value: normalizeGoogleTranslateHost(current.host),
          },
        ],
        resizable: true,
        height: 280,
        ...promptOptions(),
      },
      ctx.window,
    );
    if (!output) return;
    await setTranslationConfig(ctx, (translation) => ({
      ...translation,
      providers: {
        ...translation.providers,
        'google-translate': {
          host: normalizeGoogleTranslateHost(output[0] || current.host),
        },
      },
    }));
    return;
  }

  if (providerName === 'local-cli') {
    const current = config.translation.providers['local-cli'];
    const output = await prompt(
      {
        title: t(
          'plugins.synced-lyrics.menu.translation.providers.local-cli.prompt-title',
        ),
        label: t(
          'plugins.synced-lyrics.menu.translation.providers.local-cli.prompt-label',
        ),
        type: 'multiInput',
        multiInputOptions: [
          {
            label: t(
              'plugins.synced-lyrics.menu.translation.providers.local-cli.engine',
            ),
            selectOptions: {
              claude: t(
                'plugins.synced-lyrics.menu.translation.providers.local-cli.engine-claude',
              ),
              codex: t(
                'plugins.synced-lyrics.menu.translation.providers.local-cli.engine-codex',
              ),
              gemini: t(
                'plugins.synced-lyrics.menu.translation.providers.local-cli.engine-gemini',
              ),
            },
            value: current.engine,
          },
          {
            label: t(
              'plugins.synced-lyrics.menu.translation.providers.local-cli.timeout',
            ),
            value: String(current.timeoutSeconds),
            inputAttrs: { type: 'number', min: '15', max: '600' },
          },
        ],
        resizable: true,
        height: 320,
        ...promptOptions(),
      },
      ctx.window,
    );
    if (!output) return;
    await setTranslationConfig(ctx, (translation) => ({
      ...translation,
      providers: {
        ...translation.providers,
        'local-cli': {
          engine: normalizeLocalCliEngine(output[0] || current.engine),
          command: '',
          model: '',
          timeoutSeconds: normalizeTimeoutSeconds(
            output[1] || String(current.timeoutSeconds),
            current.timeoutSeconds,
          ),
        },
      },
    }));
  }
};

export const menu = async (
  ctx: MenuContext<SyncedLyricsPluginConfig>,
): Promise<MenuItemConstructorOptions[]> => {
  const config = await ctx.getConfig();

  return [
    {
      label: t('plugins.synced-lyrics.menu.preferred-provider.label'),
      toolTip: t('plugins.synced-lyrics.menu.preferred-provider.tooltip'),
      type: 'submenu',
      submenu: [
        {
          label: t('plugins.synced-lyrics.menu.preferred-provider.none.label'),
          toolTip: t(
            'plugins.synced-lyrics.menu.preferred-provider.none.tooltip',
          ),
          type: 'radio',
          checked: config.preferredProvider === undefined,
          click() {
            ctx.setConfig({ preferredProvider: undefined });
          },
        },
        ...providerNames.map(
          (provider) =>
            ({
              label: provider,
              type: 'radio',
              checked: config.preferredProvider === provider,
              click() {
                ctx.setConfig({ preferredProvider: provider });
              },
            }) as const,
        ),
      ],
    },
    {
      label: t('plugins.synced-lyrics.menu.precise-timing.label'),
      toolTip: t('plugins.synced-lyrics.menu.precise-timing.tooltip'),
      type: 'checkbox',
      checked: config.preciseTiming,
      click(item) {
        ctx.setConfig({
          preciseTiming: item.checked,
        });
      },
    },
    {
      label: t('plugins.synced-lyrics.menu.line-effect.label'),
      toolTip: t('plugins.synced-lyrics.menu.line-effect.tooltip'),
      type: 'submenu',
      submenu: [
        {
          label: t(
            'plugins.synced-lyrics.menu.line-effect.submenu.fancy.label',
          ),
          toolTip: t(
            'plugins.synced-lyrics.menu.line-effect.submenu.fancy.tooltip',
          ),
          type: 'radio',
          checked: config.lineEffect === 'fancy',
          click() {
            ctx.setConfig({
              lineEffect: 'fancy',
            });
          },
        },
        {
          label: t(
            'plugins.synced-lyrics.menu.line-effect.submenu.scale.label',
          ),
          toolTip: t(
            'plugins.synced-lyrics.menu.line-effect.submenu.scale.tooltip',
          ),
          type: 'radio',
          checked: config.lineEffect === 'scale',
          click() {
            ctx.setConfig({
              lineEffect: 'scale',
            });
          },
        },
        {
          label: t(
            'plugins.synced-lyrics.menu.line-effect.submenu.offset.label',
          ),
          toolTip: t(
            'plugins.synced-lyrics.menu.line-effect.submenu.offset.tooltip',
          ),
          type: 'radio',
          checked: config.lineEffect === 'offset',
          click() {
            ctx.setConfig({
              lineEffect: 'offset',
            });
          },
        },
        {
          label: t(
            'plugins.synced-lyrics.menu.line-effect.submenu.focus.label',
          ),
          toolTip: t(
            'plugins.synced-lyrics.menu.line-effect.submenu.focus.tooltip',
          ),
          type: 'radio',
          checked: config.lineEffect === 'focus',
          click() {
            ctx.setConfig({
              lineEffect: 'focus',
            });
          },
        },
      ],
    },
    {
      label: t('plugins.synced-lyrics.menu.lyrics-font-size.label'),
      toolTip: t('plugins.synced-lyrics.menu.lyrics-font-size.tooltip'),
      type: 'submenu',
      submenu: lyricsFontSizeOptions.map((size) => ({
        label: t(
          `plugins.synced-lyrics.menu.lyrics-font-size.submenu.${size}.label`,
        ),
        toolTip: t(
          `plugins.synced-lyrics.menu.lyrics-font-size.submenu.${size}.tooltip`,
        ),
        type: 'radio' as const,
        checked: (config.lyricsFontSize ?? 'small') === size,
        click() {
          ctx.setConfig({
            lyricsFontSize: size,
          });
        },
      })),
    },
    {
      label: t('plugins.synced-lyrics.menu.default-text-string.label'),
      toolTip: t('plugins.synced-lyrics.menu.default-text-string.tooltip'),
      type: 'submenu',
      submenu: [
        { label: '♪', value: '♪' },
        { label: '" "', value: ' ' },
        { label: '...', value: ['.', '..', '...'] },
        { label: '•••', value: ['•', '••', '•••'] },
        { label: '———', value: '———' },
      ].map(({ label, value }) => ({
        label,
        type: 'radio',
        checked:
          typeof value === 'string'
            ? config.defaultTextString === value
            : JSON.stringify(config.defaultTextString) ===
              JSON.stringify(value),
        click() {
          ctx.setConfig({ defaultTextString: value });
        },
      })),
    },
    {
      label: t('plugins.synced-lyrics.menu.romanization.label'),
      toolTip: t('plugins.synced-lyrics.menu.romanization.tooltip'),
      type: 'checkbox',
      checked: config.romanization,
      click(item) {
        ctx.setConfig({
          romanization: item.checked,
        });
      },
    },
    {
      label: t('plugins.synced-lyrics.menu.convert-chinese-character.label'),
      toolTip: t(
        'plugins.synced-lyrics.menu.convert-chinese-character.tooltip',
      ),
      type: 'submenu',
      submenu: [
        {
          label: t(
            'plugins.synced-lyrics.menu.convert-chinese-character.submenu.disabled.label',
          ),
          toolTip: t(
            'plugins.synced-lyrics.menu.convert-chinese-character.submenu.disabled.tooltip',
          ),
          type: 'radio',
          checked:
            config.convertChineseCharacter === 'disabled' ||
            config.convertChineseCharacter === undefined,
          click() {
            ctx.setConfig({
              convertChineseCharacter: 'disabled',
            });
          },
        },
        {
          label: t(
            'plugins.synced-lyrics.menu.convert-chinese-character.submenu.simplified-to-traditional.label',
          ),
          toolTip: t(
            'plugins.synced-lyrics.menu.convert-chinese-character.submenu.simplified-to-traditional.tooltip',
          ),
          type: 'radio',
          checked: config.convertChineseCharacter === 'simplifiedToTraditional',
          click() {
            ctx.setConfig({
              convertChineseCharacter: 'simplifiedToTraditional',
            });
          },
        },
        {
          label: t(
            'plugins.synced-lyrics.menu.convert-chinese-character.submenu.traditional-to-simplified.label',
          ),
          toolTip: t(
            'plugins.synced-lyrics.menu.convert-chinese-character.submenu.traditional-to-simplified.tooltip',
          ),
          type: 'radio',
          checked: config.convertChineseCharacter === 'traditionalToSimplified',
          click() {
            ctx.setConfig({
              convertChineseCharacter: 'traditionalToSimplified',
            });
          },
        },
      ],
    },
    {
      label: t('plugins.synced-lyrics.menu.show-time-codes.label'),
      toolTip: t('plugins.synced-lyrics.menu.show-time-codes.tooltip'),
      type: 'checkbox',
      checked: config.showTimeCodes,
      click(item) {
        ctx.setConfig({
          showTimeCodes: item.checked,
        });
      },
    },
    {
      label: t('plugins.synced-lyrics.menu.show-lyrics-even-if-inexact.label'),
      toolTip: t(
        'plugins.synced-lyrics.menu.show-lyrics-even-if-inexact.tooltip',
      ),
      type: 'checkbox',
      checked: config.showLyricsEvenIfInexact,
      click(item) {
        ctx.setConfig({
          showLyricsEvenIfInexact: item.checked,
        });
      },
    },
    {
      label: t('plugins.synced-lyrics.menu.translation.label'),
      toolTip: t('plugins.synced-lyrics.menu.translation.tooltip'),
      type: 'submenu',
      submenu: [
        {
          label: t('plugins.synced-lyrics.menu.translation.enabled.label'),
          toolTip: t('plugins.synced-lyrics.menu.translation.enabled.tooltip'),
          type: 'checkbox',
          checked: config.translation.enabled,
          async click(item) {
            await setTranslationConfig(ctx, (translation) => ({
              ...translation,
              enabled: item.checked,
            }));
          },
        },
        {
          label: t('plugins.synced-lyrics.menu.translation.provider.label'),
          toolTip: t('plugins.synced-lyrics.menu.translation.provider.tooltip'),
          type: 'submenu',
          submenu: providerOrder.map((p) => ({
            label: t(
              `plugins.synced-lyrics.menu.translation.providers.${p}.name`,
            ),
            type: 'radio' as const,
            checked: config.translation.provider === p,
            async click() {
              await setTranslationConfig(ctx, (translation) => ({
                ...translation,
                provider: p,
              }));
            },
          })),
        },
        {
          label: t(
            'plugins.synced-lyrics.menu.translation.target-language.label',
          ),
          toolTip: t(
            'plugins.synced-lyrics.menu.translation.target-language.tooltip',
          ),
          type: 'submenu',
          submenu: targetLanguageOptions.map((lang) => ({
            label: t(
              `plugins.synced-lyrics.menu.translation.target-language.options.${lang}`,
            ),
            type: 'radio' as const,
            checked: config.translation.targetLanguage === lang,
            async click() {
              await setTranslationConfig(ctx, (translation) => ({
                ...translation,
                targetLanguage: lang,
              }));
            },
          })),
        },
        {
          label: t('plugins.synced-lyrics.menu.translation.configure.label'),
          toolTip: t(
            'plugins.synced-lyrics.menu.translation.configure.tooltip',
          ),
          type: 'submenu',
          submenu: providerOrder.map((p) => ({
            label: t(
              `plugins.synced-lyrics.menu.translation.providers.${p}.name`,
            ),
            async click() {
              await promptProviderSettings(p, ctx).catch((err: unknown) => {
                console.error('[synced-lyrics] prompt failed:', err);
              });
            },
          })),
        },
        {
          label: t('plugins.synced-lyrics.menu.translation.clear-cache.label'),
          toolTip: t(
            'plugins.synced-lyrics.menu.translation.clear-cache.tooltip',
          ),
          async click() {
            await clearTranslationCache();
          },
        },
      ],
    },
    {
      label: t(
        'plugins.synced-lyrics.menu.use-ytm-lyrics-without-proxy.label',
      ),
      toolTip: t(
        'plugins.synced-lyrics.menu.use-ytm-lyrics-without-proxy.tooltip',
      ),
      type: 'checkbox',
      checked: config.useYTMLyricsWithoutProxy,
      click(item) {
        ctx.setConfig({
          useYTMLyricsWithoutProxy: item.checked,
        });
      },
    },
    {
      label: t(
        'plugins.synced-lyrics.menu.show-custom-search-button.label',
      ),
      toolTip: t(
        'plugins.synced-lyrics.menu.show-custom-search-button.tooltip',
      ),
      type: 'checkbox',
      checked: config.showCustomSearchButton !== false,
      click(item) {
        ctx.setConfig({
          showCustomSearchButton: item.checked,
        });
      },
    },
  ];
};
