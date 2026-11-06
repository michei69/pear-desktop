import { type MenuItemConstructorOptions } from 'electron';

import { t } from '@/i18n';
import { type MenuContext } from '@/types/contexts';

import { type AmbientModePluginConfig, type AmbientModeStyle } from './types';

const ambientStyleOptions: AmbientModeStyle[] = ['standard', 'ambilight'];

export const menu = async ({
  getConfig,
  setConfig,
}: MenuContext<AmbientModePluginConfig>): Promise<
  MenuItemConstructorOptions[]
> => {
  const interpolationTimeList = [0, 500, 1000, 1500, 2000, 3000, 4000, 5000];
  const qualityList = [10, 25, 50, 100, 200, 500, 1000];
  const sizeList = [100, 110, 125, 150, 175, 200, 300];
  const bufferList = [1, 5, 10, 20, 30];
  const blurAmountList = [0, 5, 10, 25, 50, 100, 150, 200, 500];
  const opacityList = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

  const config = await getConfig();

  return [
    {
      label: t('plugins.ambient-mode.menu.style.label'),
      submenu: ambientStyleOptions.map((style) => ({
        label: t(`plugins.ambient-mode.menu.style.submenu.${style}.label`),
        toolTip: t(`plugins.ambient-mode.menu.style.submenu.${style}.tooltip`),
        type: 'radio',
        checked: (config.style ?? 'standard') === style,
        click() {
          setConfig({ style });
        },
      })),
    },
    {
      label: t('plugins.ambient-mode.menu.smoothness-transition.label'),
      submenu: interpolationTimeList.map((interpolationTime) => ({
        label: t(
          'plugins.ambient-mode.menu.smoothness-transition.submenu.during',
          {
            interpolationTime: interpolationTime / 1000,
          },
        ),
        type: 'radio',
        checked: config.interpolationTime === interpolationTime,
        click() {
          setConfig({ interpolationTime });
        },
      })),
    },
    {
      label: t('plugins.ambient-mode.menu.quality.label'),
      submenu: qualityList.map((quality) => ({
        label: t('plugins.ambient-mode.menu.quality.submenu.pixels', {
          quality,
        }),
        type: 'radio',
        checked: config.quality === quality,
        click() {
          setConfig({ quality });
        },
      })),
    },
    {
      label: t('plugins.ambient-mode.menu.size.label'),
      submenu: sizeList.map((size) => ({
        label: t('plugins.ambient-mode.menu.size.submenu.percent', { size }),
        type: 'radio',
        checked: config.size === size,
        click() {
          setConfig({ size });
        },
      })),
    },
    {
      label: t('plugins.ambient-mode.menu.buffer.label'),
      submenu: bufferList.map((buffer) => ({
        label: t('plugins.ambient-mode.menu.buffer.submenu.buffer', {
          buffer,
        }),
        type: 'radio',
        checked: config.buffer === buffer,
        click() {
          setConfig({ buffer });
        },
      })),
    },
    {
      label: t('plugins.ambient-mode.menu.opacity.label'),
      submenu: opacityList.map((opacity) => ({
        label: t('plugins.ambient-mode.menu.opacity.submenu.percent', {
          opacity: opacity * 100,
        }),
        type: 'radio',
        checked: config.opacity === opacity,
        click() {
          setConfig({ opacity });
        },
      })),
    },
    {
      label: t('plugins.ambient-mode.menu.blur-amount.label'),
      submenu: blurAmountList.map((blur) => ({
        label: t('plugins.ambient-mode.menu.blur-amount.submenu.pixels', {
          blurAmount: blur,
        }),
        type: 'radio',
        checked: config.blur === blur,
        click() {
          setConfig({ blur });
        },
      })),
    },
    {
      label: t('plugins.ambient-mode.menu.extend-sidebar.label'),
      type: 'checkbox',
      checked: config.extendSidebar,
      click(item: Electron.MenuItem) {
        setConfig({ extendSidebar: item.checked });
      },
    },
    {
      label: t('plugins.ambient-mode.menu.use-fullscreen.label'),
      type: 'checkbox',
      checked: config.fullscreen,
      click(item: Electron.MenuItem) {
        setConfig({ fullscreen: item.checked });
      },
    },
  ];
};
