import { StatusDisplayType } from 'discord-api-types/v10';

import { APPLICATION_NAME, t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './main';
import { onMenu } from './menu';
import { STATUS_DISPLAY_TYPES, statusDisplayLabel } from './status-display';

export type DiscordPluginConfig = {
  'enabled': boolean;
  /**
   * Reconnect after disconnecting or failing to connect, backing off from 5
   * seconds up to 5 minutes
   * @default true
   */
  'autoReconnect': boolean;
  /**
   * Clear the rich presence when music is paused for the timeout below
   */
  'activityTimeoutEnabled': boolean;
  /**
   * Milliseconds of pause before the rich presence is cleared
   * @default 10 * 60 * 1000 (10 minutes)
   */
  'activityTimeoutTime': number;
  /**
   * Add a "Play on $APPLICATION_NAME" button to rich presence
   */
  'playOn\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u004d\u0075\u0073\u0069\u0063': boolean;
  /**
   * Hide the "View App On GitHub" button in the rich presence
   */
  'hideGitHubButton': boolean;
  /**
   * Hide the "duration left" in the rich presence
   */
  'hideDurationLeft': boolean;
  /**
   * Controls which field is displayed in the Discord status text
   */
  'statusDisplayType': (typeof StatusDisplayType)[keyof typeof StatusDisplayType];
};

export default createPlugin({
  name: () => t('plugins.discord.name'),
  description: () => t('plugins.discord.description'),
  restartNeeded: false,
  config: {
    'enabled': false,
    'autoReconnect': true,
    'activityTimeoutEnabled': true,
    'activityTimeoutTime': 10 * 60 * 1000,
    'playOn\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u004d\u0075\u0073\u0069\u0063': true,
    'hideGitHubButton': false,
    'hideDurationLeft': false,
    'statusDisplayType': StatusDisplayType.Details,
  } as DiscordPluginConfig,
  settings: [
    {
      type: 'switch',
      key: 'autoReconnect',
      label: () => t('plugins.discord.settings.auto-reconnect'),
    },
    {
      type: 'switch',
      key: 'activityTimeoutEnabled',
      label: () => t('plugins.discord.settings.activity-timeout-enabled'),
    },
    {
      type: 'slider',
      key: 'activityTimeoutTime',
      label: () => t('plugins.discord.settings.activity-timeout-time'),
      min: 1,
      max: 60,
      unit: 'min',
      scale: 60 * 1000,
    },
    {
      type: 'switch',
      key: 'playOn\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u004d\u0075\u0073\u0069\u0063',
      label: () =>
        t('plugins.discord.menu.play-on-application', {
          applicationName: APPLICATION_NAME,
        }),
    },
    {
      type: 'switch',
      key: 'hideGitHubButton',
      label: () => t('plugins.discord.settings.hide-github-button'),
    },
    {
      type: 'switch',
      key: 'hideDurationLeft',
      label: () => t('plugins.discord.settings.hide-duration-left'),
    },
    {
      type: 'select',
      variant: 'dropdown',
      key: 'statusDisplayType',
      label: () => t('plugins.discord.menu.set-status-display-type.label'),
      options: STATUS_DISPLAY_TYPES.map((value) => ({
        value,
        label: () => statusDisplayLabel(value),
      })),
    },
  ],
  menu: onMenu,
  backend,
});
