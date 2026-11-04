import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { onMainLoad, onMainStop } from './main';
import { onMenu } from './menu';

export type ShortcutMappingType = {
  previous: string;
  playPause: string;
  next: string;
  like: string;
  dislike: string;
};
export type ShortcutsPluginConfig = {
  enabled: boolean;
  overrideMediaKeys: boolean;
  global: ShortcutMappingType;
  local: ShortcutMappingType;
};

const KEYBIND_FIELDS = [
  {
    action: 'previous',
    labelKey: 'plugins.shortcuts.prompt.keybind.keybind-options.previous',
    placeholderKey: 'plugins.shortcuts.settings.placeholder.previous',
  },
  {
    action: 'playPause',
    labelKey: 'plugins.shortcuts.prompt.keybind.keybind-options.play-pause',
    placeholderKey: 'plugins.shortcuts.settings.placeholder.play-pause',
  },
  {
    action: 'next',
    labelKey: 'plugins.shortcuts.prompt.keybind.keybind-options.next',
    placeholderKey: 'plugins.shortcuts.settings.placeholder.next',
  },
  {
    action: 'like',
    labelKey: 'plugins.shortcuts.prompt.keybind.keybind-options.like',
    placeholderKey: 'plugins.shortcuts.settings.placeholder.like',
  },
  {
    action: 'dislike',
    labelKey: 'plugins.shortcuts.prompt.keybind.keybind-options.dislike',
    placeholderKey: 'plugins.shortcuts.settings.placeholder.dislike',
  },
] as const;

const keybindFields = (scope: 'global' | 'local') =>
  KEYBIND_FIELDS.map((field) => ({
    type: 'text' as const,
    key: `${scope}.${field.action}`,
    label: () => t(field.labelKey),
    placeholder: () => t(field.placeholderKey),
    restartNeeded: true,
  }));

export default createPlugin({
  name: () => t('plugins.shortcuts.name'),
  description: () => t('plugins.shortcuts.description'),
  restartNeeded: true,
  config: {
    enabled: false,
    overrideMediaKeys: false,
    global: {
      previous: '',
      playPause: '',
      next: '',
      like: '',
      dislike: '',
    },
    local: {
      previous: '',
      playPause: '',
      next: '',
      like: '',
      dislike: '',
    },
  } as ShortcutsPluginConfig,
  settings: [
    {
      fields: [
        {
          type: 'switch',
          key: 'overrideMediaKeys',
          label: () => t('plugins.shortcuts.menu.override-media-keys'),
          restartNeeded: true,
        },
      ],
    },
    {
      title: () => t('plugins.shortcuts.settings.global-keybinds'),
      fields: keybindFields('global'),
    },
    {
      title: () => t('plugins.shortcuts.settings.local-keybinds'),
      fields: keybindFields('local'),
    },
  ],
  menu: onMenu,

  backend: {
    start: onMainLoad,
    stop: onMainStop,
  },
});
