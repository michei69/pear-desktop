import { t } from '@/i18n';
import { openSettings } from '@/plugins/settings-ui/renderer';

import { registerCommand } from './commands';
import { parseVideoId } from './video-id';

import type { RendererContext } from '@/types/contexts';
import type { PluginConfig } from '@/types/plugins';

/** Returns an unregister function. */
export const registerBuiltinCommands = (
  ctx: RendererContext<PluginConfig>,
): (() => void) => {
  const unregister = [
    registerCommand({
      name: 'settings',
      description: () => t('plugins.search-commands.commands.settings'),
      run: () => openSettings(),
    }),

    registerCommand({
      name: 'play',
      description: () => t('plugins.search-commands.commands.play'),
      args: [{ name: 'url' }],
      run: (args) => {
        const videoId = parseVideoId(args[0] ?? '');
        if (!videoId) return;

        ctx.ipc
          .invoke('search-commands:play', videoId)
          .catch((error) => console.error('Could not play video', error));
      },
    }),
  ];

  return () => {
    for (const off of unregister) off();
  };
};
