import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { onMainLoad, onMainStop } from './main';
import { onMenu } from './menu';

export type ShortcutMappingType = {
  previous: string;
  playPause: string;
  next: string;
};
export type ShortcutsPluginConfig = {
  enabled: boolean;
  overrideMediaKeys: boolean;
  global: ShortcutMappingType;
  local: ShortcutMappingType;
};

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
    },
    local: {
      previous: '',
      playPause: '',
      next: '',
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
      fields: [
        {
          type: 'text',
          key: 'global.previous',
          label: () =>
            t('plugins.shortcuts.prompt.keybind.keybind-options.previous'),
          placeholder: () => 'e.g. CmdOrCtrl+Shift+Left',
          restartNeeded: true,
        },
        {
          type: 'text',
          key: 'global.playPause',
          label: () =>
            t('plugins.shortcuts.prompt.keybind.keybind-options.play-pause'),
          placeholder: () => 'e.g. CmdOrCtrl+Shift+Space',
          restartNeeded: true,
        },
        {
          type: 'text',
          key: 'global.next',
          label: () =>
            t('plugins.shortcuts.prompt.keybind.keybind-options.next'),
          placeholder: () => 'e.g. CmdOrCtrl+Shift+Right',
          restartNeeded: true,
        },
      ],
    },
    {
      title: () => t('plugins.shortcuts.settings.local-keybinds'),
      fields: [
        {
          type: 'text',
          key: 'local.previous',
          label: () =>
            t('plugins.shortcuts.prompt.keybind.keybind-options.previous'),
          placeholder: () => 'e.g. CmdOrCtrl+Shift+Left',
          restartNeeded: true,
        },
        {
          type: 'text',
          key: 'local.playPause',
          label: () =>
            t('plugins.shortcuts.prompt.keybind.keybind-options.play-pause'),
          placeholder: () => 'e.g. CmdOrCtrl+Shift+Space',
          restartNeeded: true,
        },
        {
          type: 'text',
          key: 'local.next',
          label: () =>
            t('plugins.shortcuts.prompt.keybind.keybind-options.next'),
          placeholder: () => 'e.g. CmdOrCtrl+Shift+Right',
          restartNeeded: true,
        },
      ],
    },
  ],
  menu: onMenu,

  backend: {
    start: onMainLoad,
    stop: onMainStop,
  },
});
