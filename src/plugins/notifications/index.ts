import { t } from '@/i18n';
import { Platform } from '@/types/plugins';
import { createPlugin } from '@/utils';

import { ToastStyles, toastStyleLabel, urgencyLevels } from './labels';
import { onConfigChange, onMainLoad, onStop } from './main';
import { onMenu } from './menu';

export interface NotificationsPluginConfig {
  enabled: boolean;
  unpauseNotification: boolean;
  /** Linux only. */
  urgency: 'low' | 'normal' | 'critical';
  /** The following are Windows only. */
  interactive: boolean;
  /** See `plugins/notifications/utils`. */
  toastStyle: number;
  refreshOnPlayPause: boolean;
  hideButtonText: boolean;
  hoverControls: boolean;
}

export const defaultConfig: NotificationsPluginConfig = {
  enabled: false,
  unpauseNotification: false,
  urgency: 'normal',
  interactive: true,
  toastStyle: 1,
  refreshOnPlayPause: false,
  hideButtonText: false,
  hoverControls: true,
};

export default createPlugin({
  name: () => t('plugins.notifications.name'),
  description: () => t('plugins.notifications.description'),
  config: defaultConfig,
  settings: [
    {
      type: 'switch',
      key: 'unpauseNotification',
      label: () => t('plugins.notifications.menu.unpause-notification'),
    },
    {
      type: 'select',
      key: 'urgency',
      label: () => t('plugins.notifications.menu.priority'),
      platform: Platform.Linux,
      options: urgencyLevels.map(({ name, value }) => ({
        value,
        label: name,
      })),
    },
    {
      type: 'switch',
      key: 'interactive',
      label: () => t('plugins.notifications.menu.interactive'),
      platform: Platform.Windows,
      restartNeeded: true,
    },
    {
      type: 'switch',
      key: 'hoverControls',
      label: () =>
        t(
          'plugins.notifications.menu.interactive-settings.submenu.hover-controls',
        ),
      platform: Platform.Windows,
    },
    {
      type: 'switch',
      key: 'hideButtonText',
      label: () =>
        t(
          'plugins.notifications.menu.interactive-settings.submenu.hide-button-text',
        ),
      platform: Platform.Windows,
    },
    {
      type: 'switch',
      key: 'refreshOnPlayPause',
      label: () =>
        t(
          'plugins.notifications.menu.interactive-settings.submenu.refresh-on-play-pause',
        ),
      platform: Platform.Windows,
    },
    {
      type: 'select',
      variant: 'dropdown',
      key: 'toastStyle',
      label: () => t('plugins.notifications.menu.toast-style'),
      platform: Platform.Windows,
      options: Object.entries(ToastStyles).map(([name, value]) => ({
        value,
        label: () => toastStyleLabel(name as keyof typeof ToastStyles),
      })),
    },
  ],
  menu: onMenu,
  backend: {
    start: onMainLoad,
    stop: onStop,
    onConfigChange,
  },
});
