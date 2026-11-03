import prompt from 'custom-electron-prompt';

import { setMenuOptions } from '@/config/plugins';
import { APPLICATION_NAME, t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';

import { discordService } from './main';
import { STATUS_DISPLAY_TYPES, statusDisplayLabel } from './status-display';

import type { DiscordPluginConfig } from './index';
import type { MenuTemplate } from '@/menu';
import type { MenuContext } from '@/types/contexts';

export const onMenu = async ({
  window,
  getConfig,
  setConfig,
  refresh,
}: MenuContext<DiscordPluginConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();
  discordService?.registerRefreshCallback(refresh);

  return [
    {
      label: discordService?.isConnected()
        ? t('plugins.discord.menu.connected')
        : t('plugins.discord.menu.disconnected'),
      enabled: !discordService?.isConnected(),
      click: () => discordService?.connect(),
    },
    {
      label: t('plugins.discord.menu.auto-reconnect'),
      type: 'checkbox',
      checked: config.autoReconnect,
      click(item: Electron.MenuItem) {
        setConfig({
          autoReconnect: item.checked,
        });
      },
    },
    {
      label: t('plugins.discord.menu.clear-activity'),
      click: () => discordService?.clearActivity(),
    },
    {
      label: t('plugins.discord.menu.clear-activity-after-timeout'),
      type: 'checkbox',
      checked: config.activityTimeoutEnabled,
      click(item: Electron.MenuItem) {
        setConfig({
          activityTimeoutEnabled: item.checked,
        });
      },
    },
    {
      label: t('plugins.discord.menu.play-on-application', {
        applicationName: APPLICATION_NAME,
      }),
      type: 'checkbox',
      checked:
        config[
          'playOn\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u004d\u0075\u0073\u0069\u0063'
        ],
      click(item: Electron.MenuItem) {
        setConfig({
          'playOn\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u004d\u0075\u0073\u0069\u0063':
            item.checked,
        });
      },
    },
    {
      label: t('plugins.discord.menu.hide-github-button'),
      type: 'checkbox',
      checked: config.hideGitHubButton,
      click(item: Electron.MenuItem) {
        setConfig({
          hideGitHubButton: item.checked,
        });
      },
    },
    {
      label: t('plugins.discord.menu.hide-duration-left'),
      type: 'checkbox',
      checked: config.hideDurationLeft,
      click(item: Electron.MenuItem) {
        setConfig({
          hideDurationLeft: item.checked,
        });
      },
    },
    {
      label: t('plugins.discord.menu.set-inactivity-timeout'),
      click: () => setInactivityTimeout(window, config),
    },
    {
      label: t('plugins.discord.menu.set-status-display-type.label'),
      submenu: STATUS_DISPLAY_TYPES.map((statusDisplayType) => ({
        label: statusDisplayLabel(statusDisplayType),
        type: 'radio' as const,
        checked: config.statusDisplayType === statusDisplayType,
        click() {
          setConfig({ statusDisplayType });
        },
      })),
    },
  ];
};

async function setInactivityTimeout(
  win: Electron.BrowserWindow,
  options: DiscordPluginConfig,
) {
  const output = await prompt(
    {
      title: t('plugins.discord.prompt.set-inactivity-timeout.title'),
      label: t('plugins.discord.prompt.set-inactivity-timeout.label'),
      value: String(Math.round((options.activityTimeoutTime ?? 0) / 1e3)),
      type: 'counter',
      counterOptions: { minimum: 0, multiFire: true },
      width: 450,
      ...promptOptions(),
    },
    win,
  );

  if (output) {
    options.activityTimeoutTime = Math.round(~~output * 1e3);
    setMenuOptions('discord', options);
  }
}
