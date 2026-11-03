import { t } from '@/i18n';

import type { StatusbarLyricsPluginConfig } from './index';
import type { MenuContext } from '@/types/contexts';
import type { MenuItemConstructorOptions } from 'electron';

const MAX_LENGTH_CHOICES = [30, 40, 55, 70, 85, 100, 120];

export const menu = async (
  ctx: MenuContext<StatusbarLyricsPluginConfig>,
): Promise<MenuItemConstructorOptions[]> => {
  const config = await ctx.getConfig();

  return [
    {
      label: t('plugins.statusbar-lyrics.menu.max-length'),
      type: 'submenu',
      submenu: MAX_LENGTH_CHOICES.map((maxLength) => ({
        label: `${maxLength}`,
        type: 'radio',
        checked: config.maxLength === maxLength,
        click() {
          ctx.setConfig({ maxLength });
        },
      })),
    },
    {
      label: t('plugins.statusbar-lyrics.menu.include-pronunciation'),
      toolTip: t('plugins.statusbar-lyrics.menu.include-pronunciation-tooltip'),
      type: 'checkbox',
      checked: config.includePronunciation,
      click(item) {
        ctx.setConfig({ includePronunciation: item.checked });
      },
    },
  ];
};
