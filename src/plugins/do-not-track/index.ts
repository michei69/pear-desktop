import { contextBridge, webFrame, type BrowserWindow } from 'electron';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import {
  isBlockerEnabled,
  loadTrackerBlockerEngine,
  unloadTrackerBlockerEngine,
} from './blocker';
import { inject, isInjected } from './injectors/inject';
import injectCliqzPreload from './injectors/inject-cliqz-preload';
import { blockers } from './types';

export interface TrackerBlockerConfig {
  /** Enable the tracker blocker. @default true */
  enabled: boolean;
  /** Cache the blocklists. @default true */
  cache: boolean;
  /** Which tracker blocker to use. @default blockers.InPlayer */
  blocker: (typeof blockers)[keyof typeof blockers];
  /** Extra filter lists to load. @default [] */
  additionalBlockLists: string[];
  /** Skip the built-in blocklists. @default false */
  disableDefaultLists: boolean;
}

export default createPlugin({
  name: () => t('plugins.do-not-track.name'),
  description: () => t('plugins.do-not-track.description'),
  restartNeeded: false,
  config: {
    enabled: true,
    cache: true,
    blocker: blockers.InPlayer,
    additionalBlockLists: [],
    disableDefaultLists: false,
  } as TrackerBlockerConfig,
  settings: [
    {
      type: 'select',
      key: 'blocker',
      label: () => t('plugins.do-not-track.menu.blocker'),
      options: Object.values(blockers).map((blocker) => ({
        value: blocker,
        label: () => blocker,
      })),
    },
    {
      type: 'switch',
      key: 'cache',
      label: () => t('plugins.do-not-track.settings.cache'),
      restartNeeded: true,
    },
    {
      type: 'switch',
      key: 'disableDefaultLists',
      label: () => t('plugins.do-not-track.settings.disable-default-lists'),
      restartNeeded: true,
    },
  ],
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();

    return [
      {
        label: t('plugins.do-not-track.menu.blocker'),
        submenu: Object.values(blockers).map((blocker) => ({
          label: blocker,
          type: 'radio',
          checked: (config.blocker || blockers.WithBlocklists) === blocker,
          click() {
            setConfig({ blocker });
          },
        })),
      },
    ];
  },
  backend: {
    mainWindow: null as BrowserWindow | null,
    async start({ getConfig, window }) {
      const config = await getConfig();
      this.mainWindow = window;

      if (config.blocker === blockers.WithBlocklists) {
        await loadTrackerBlockerEngine(
          window.webContents.session,
          config.cache,
          config.additionalBlockLists,
          config.disableDefaultLists,
        );
      }
    },
    stop({ window }) {
      if (isBlockerEnabled(window.webContents.session)) {
        unloadTrackerBlockerEngine(window.webContents.session);
      }
    },
    async onConfigChange(newConfig) {
      if (this.mainWindow) {
        if (
          newConfig.blocker === blockers.WithBlocklists &&
          !isBlockerEnabled(this.mainWindow.webContents.session)
        ) {
          await loadTrackerBlockerEngine(
            this.mainWindow.webContents.session,
            newConfig.cache,
            newConfig.additionalBlockLists,
            newConfig.disableDefaultLists,
          );
        }
      }
    },
  },
  preload: {
    // see #1478
    script: `const _prunerFn = window._pruner;
    window._pruner = undefined;
    JSON.parse = new Proxy(JSON.parse, {
      apply() {
        return _prunerFn(Reflect.apply(...arguments));
      },
    });
    Response.prototype.json = new Proxy(Response.prototype.json, {
      apply() {
        return Reflect.apply(...arguments).then((o) => _prunerFn(o));
      },
    }); 0`,
    async start({ getConfig }) {
      const config = await getConfig();

      if (config.blocker === blockers.InPlayer && !isInjected()) {
        inject(contextBridge);
        await webFrame.executeJavaScript(this.script);
      } else if (config.blocker === blockers.WithBlocklists) {
        await injectCliqzPreload();
      }
    },
    async onConfigChange(newConfig) {
      if (newConfig.blocker === blockers.InPlayer && !isInjected()) {
        inject(contextBridge);
        await webFrame.executeJavaScript(this.script);
      }
    },
  },
});
