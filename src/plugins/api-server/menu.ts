import prompt from 'custom-electron-prompt';
import { dialog } from 'electron';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';

import { AuthStrategy, type APIServerConfig } from './config';

import type { MenuTemplate } from '@/menu';
import type { MenuContext } from '@/types/contexts';

export const onMenu = async ({
  getConfig,
  setConfig,
  window,
}: MenuContext<APIServerConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();

  return [
    {
      label: t('plugins.api-server.menu.hostname.label'),
      type: 'normal',
      async click() {
        const hostname = await prompt(
          {
            title: t('plugins.api-server.prompt.hostname.title'),
            label: t('plugins.api-server.prompt.hostname.label'),
            value: (await getConfig()).hostname,
            type: 'input',
            width: 380,
            ...promptOptions(),
          },
          window,
        );

        if (hostname !== null) {
          setConfig({ hostname });
        }
      },
    },
    {
      label: t('plugins.api-server.menu.port.label'),
      type: 'normal',
      async click() {
        const port = await prompt(
          {
            title: t('plugins.api-server.prompt.port.title'),
            label: t('plugins.api-server.prompt.port.label'),
            value: (await getConfig()).port,
            type: 'counter',
            counterOptions: { minimum: 0, maximum: 65535 },
            width: 380,
            ...promptOptions(),
          },
          window,
        );

        if (port !== null) {
          setConfig({ port });
        }
      },
    },
    {
      label: t('plugins.api-server.menu.auth-strategy.label'),
      type: 'submenu',
      submenu: [
        {
          label: t(
            'plugins.api-server.menu.auth-strategy.submenu.auth-at-first.label',
          ),
          type: 'radio',
          checked: config.authStrategy === AuthStrategy.AUTH_AT_FIRST,
          click() {
            setConfig({ authStrategy: AuthStrategy.AUTH_AT_FIRST });
          },
        },
        {
          label: t('plugins.api-server.menu.auth-strategy.submenu.none.label'),
          type: 'radio',
          checked: config.authStrategy === AuthStrategy.NONE,
          click() {
            setConfig({ authStrategy: AuthStrategy.NONE });
          },
        },
      ],
    },
    {
      label: t('plugins.api-server.menu.https.label'),
      type: 'submenu',
      submenu: [
        {
          label: t('plugins.api-server.menu.https.submenu.enable-https.label'),
          type: 'checkbox',
          checked: config.useHttps,
          click(menuItem) {
            setConfig({ useHttps: menuItem.checked });
          },
        },
        {
          label: t('plugins.api-server.menu.https.submenu.cert.label'),
          type: 'normal',
          async click() {
            const result = await dialog.showOpenDialog(window, {
              title: t(
                'plugins.api-server.menu.https.submenu.cert.dialogTitle',
              ),
              filters: [{ name: 'Certificate', extensions: ['crt', 'pem'] }],
              properties: ['openFile'],
            });

            if (!result.canceled && result.filePaths.length > 0) {
              setConfig({ certPath: result.filePaths[0] });
            }
          },
        },
        {
          label: t('plugins.api-server.menu.https.submenu.key.label'),
          type: 'normal',
          async click() {
            const result = await dialog.showOpenDialog(window, {
              title: t('plugins.api-server.menu.https.submenu.key.dialogTitle'),
              filters: [{ name: 'Private Key', extensions: ['key', 'pem'] }],
              properties: ['openFile'],
            });

            if (!result.canceled && result.filePaths.length > 0) {
              setConfig({ keyPath: result.filePaths[0] });
            }
          },
        },
      ],
    },
  ];
};
