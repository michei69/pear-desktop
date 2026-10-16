import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './backend';
import { AuthStrategy, defaultAPIServerConfig } from './config';
import { onMenu } from './menu';
import { renderer } from './renderer';

export default createPlugin({
  name: () => t('plugins.api-server.name'),
  description: () => t('plugins.api-server.description'),
  restartNeeded: false,
  config: defaultAPIServerConfig,
  addedVersion: '3.6.X',
  settings: [
    {
      type: 'text',
      key: 'hostname',
      label: () => t('plugins.api-server.menu.hostname.label'),
    },
    {
      type: 'number',
      key: 'port',
      label: () => t('plugins.api-server.menu.port.label'),
      min: 0,
      max: 65535,
    },
    {
      type: 'select',
      key: 'authStrategy',
      label: () => t('plugins.api-server.menu.auth-strategy.label'),
      options: [
        {
          value: AuthStrategy.AUTH_AT_FIRST,
          label: () =>
            t(
              'plugins.api-server.menu.auth-strategy.submenu.auth-at-first.label',
            ),
        },
        {
          value: AuthStrategy.NONE,
          label: () =>
            t('plugins.api-server.menu.auth-strategy.submenu.none.label'),
        },
      ],
    },
    {
      type: 'switch',
      key: 'useHttps',
      label: () =>
        t('plugins.api-server.menu.https.submenu.enable-https.label'),
    },
    {
      type: 'action',
      key: 'certPath',
      label: () => t('plugins.api-server.menu.https.submenu.cert.label'),
      buttons: [
        {
          label: () => t('plugins.api-server.settings.choose-file'),
          onClick: async ({ pickFile, setValue }) => {
            const file = await pickFile([
              { name: 'Certificate', extensions: ['crt', 'pem'] },
            ]);
            if (file) setValue('certPath', file);
          },
        },
      ],
    },
    {
      type: 'action',
      key: 'keyPath',
      label: () => t('plugins.api-server.menu.https.submenu.key.label'),
      buttons: [
        {
          label: () => t('plugins.api-server.settings.choose-file'),
          onClick: async ({ pickFile, setValue }) => {
            const file = await pickFile([
              { name: 'Private Key', extensions: ['key', 'pem'] },
            ]);
            if (file) setValue('keyPath', file);
          },
        },
      ],
    },
  ],
  menu: onMenu,

  backend,
  renderer,
});
