import { contextBridge, dialog, webFrame, type BrowserWindow } from 'electron';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import {
  getLocalBlockListNames,
  isBlockerEnabled,
  loadTrackerBlockerEngine,
  unloadTrackerBlockerEngine,
} from './blocker';
import { inject, isInjected } from './injectors/inject';
import injectCliqzPreload from './injectors/inject-cliqz-preload';
import balancedRules from './lists/balanced.txt?raw';
import strictRules from './lists/strict-addon.txt?raw';
import { createProfileReloadPrompt, profileKey } from './profile-reload';
import { blockers, isLegacyCustomBlocker, normalizeBlocker } from './types';

const usesBlockLists = (blocker: unknown, customEnabled: unknown) =>
  normalizeBlocker(blocker) !== blockers.Lite || customEnabled === true;

const getPresetBlockLists = (blocker: unknown): string[] => {
  const normalizedBlocker = normalizeBlocker(blocker);
  const includeBalanced =
    normalizedBlocker === blockers.Balanced ||
    normalizedBlocker === blockers.Strict;

  return [
    ...(includeBalanced ? [balancedRules] : []),
    ...(normalizedBlocker === blockers.Strict ? [strictRules] : []),
  ];
};

export interface TrackerBlockerConfig {
  /** Enable the tracker blocker. @default true */
  enabled: boolean;
  /** Cache the blocklists. @default true */
  cache: boolean;
  /**
   * Which tracker blocker to use.
   * @default blockers.Lite
   */
  blocker: (typeof blockers)[keyof typeof blockers];
  /** Extra filter lists to load. @default [] */
  additionalBlockLists: string[];
  /**
   * Individual Adblock Plus/uBlock filter rules.
   * @default []
   */
  additionalBlockListRules: string[];
  /**
   * Local blocklist file names disabled in Custom mode. Files not listed here
   * are enabled by default.
   * @default []
   */
  disabledLocalBlockLists: string[];
  /**
   * Apply local, inline, remote, and selected built-in Custom profiles in
   * addition to the active base profile.
   * @default false
   */
  customEnabled: boolean;
  /**
   * Disable the default blocklists.
   * @default false
   */
  disableDefaultLists: boolean;
}

export default createPlugin({
  name: () => t('plugins.do-not-track.name'),
  description: () => t('plugins.do-not-track.description'),
  restartNeeded: false,
  config: {
    enabled: true,
    cache: true,
    blocker: blockers.Lite,
    additionalBlockLists: [],
    additionalBlockListRules: [],
    customEnabled: false,
    disabledLocalBlockLists: [],
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
  menu: async ({ getConfig, setConfig, refresh }) => {
    const config = await getConfig();
    const localBlockLists = await getLocalBlockListNames();

    // The menu is rebuilt from scratch by `refresh()` after every write, so the
    // checked/enabled state follows the stored config instead of the snapshot
    // this invocation was built from.
    return [
      ...Object.values(blockers).map((blocker) => ({
        label: blocker,
        type: 'radio' as const,
        checked: normalizeBlocker(config.blocker) === blocker,
        async click() {
          await setConfig({ blocker });
          await refresh();
        },
      })),
      { type: 'separator' },
      {
        label: 'Custom',
        submenu: [
          {
            label: 'Enabled',
            type: 'checkbox',
            checked: config.customEnabled === true,
            async click() {
              const latest = await getConfig();
              await setConfig({ customEnabled: latest.customEnabled !== true });
              await refresh();
            },
          },
          ...localBlockLists.map((file) => ({
            label: file,
            type: 'checkbox' as const,
            enabled: config.customEnabled === true,
            checked: !config.disabledLocalBlockLists.includes(file),
            async click() {
              const latest = await getConfig();
              const disabled = new Set(latest.disabledLocalBlockLists);
              if (disabled.has(file)) {
                disabled.delete(file);
              } else {
                disabled.add(file);
              }
              await setConfig({ disabledLocalBlockLists: [...disabled] });
              await refresh();
            },
          })),
        ],
      },
    ];
  },
  backend: {
    mainWindow: null as BrowserWindow | null,
    reloadPromise: Promise.resolve(),
    generation: 0,
    currentProfile: null as string | null,
    promptReload: null as (() => Promise<void>) | null,
    async start({ getConfig, setConfig, window }) {
      const generation = ++this.generation;
      const config = await getConfig();
      const blocker = normalizeBlocker(config.blocker);
      const customEnabled =
        config.customEnabled === true || isLegacyCustomBlocker(config.blocker);
      if (
        config.blocker !== blocker ||
        config.customEnabled !== customEnabled
      ) {
        await setConfig({ blocker, customEnabled });
        config.blocker = blocker;
        config.customEnabled = customEnabled;
      }
      if (generation !== this.generation || window.isDestroyed()) return;
      this.mainWindow = window;
      this.currentProfile = profileKey(config);
      const isActive = () =>
        generation === this.generation &&
        this.mainWindow === window &&
        !window.isDestroyed();
      this.promptReload = createProfileReloadPrompt({
        show: (options) => dialog.showMessageBox(window, options),
        translate: (key) => t(key),
        isActive,
        reload: async () => {
          // Apply any profile changes queued while the dialog was open first.
          await this.reloadPromise;
          if (isActive()) window.webContents.reload();
        },
      });

      if (usesBlockLists(config.blocker, config.customEnabled)) {
        await loadTrackerBlockerEngine(
          window.webContents.session,
          config.cache,
          config.customEnabled ? config.additionalBlockLists : [],
          getPresetBlockLists(config.blocker),
          config.customEnabled ? config.additionalBlockListRules : [],
          config.customEnabled ? config.disableDefaultLists : true,
          config.customEnabled,
          config.disabledLocalBlockLists,
        );
      }
    },
    stop({ window }) {
      ++this.generation;
      this.mainWindow = null;
      this.currentProfile = null;
      this.promptReload = null;
      if (!window.isDestroyed()) {
        unloadTrackerBlockerEngine(window.webContents.session);
      }
    },
    async onConfigChange(newConfig) {
      const generation = this.generation;
      this.reloadPromise = this.reloadPromise
        .catch(() => undefined)
        .then(async () => {
          if (
            generation !== this.generation ||
            !this.mainWindow ||
            this.mainWindow.isDestroyed()
          )
            return;

          const session = this.mainWindow.webContents.session;
          const nextProfile = profileKey(newConfig);
          const profileChanged =
            this.currentProfile !== null && this.currentProfile !== nextProfile;
          this.currentProfile = nextProfile;
          const wasBlockerEnabled = isBlockerEnabled(session);
          if (wasBlockerEnabled) {
            unloadTrackerBlockerEngine(session, true);
          }
          if (usesBlockLists(newConfig.blocker, newConfig.customEnabled)) {
            await loadTrackerBlockerEngine(
              session,
              newConfig.cache,
              newConfig.customEnabled ? newConfig.additionalBlockLists : [],
              getPresetBlockLists(newConfig.blocker),
              newConfig.customEnabled ? newConfig.additionalBlockListRules : [],
              newConfig.customEnabled ? newConfig.disableDefaultLists : true,
              newConfig.customEnabled,
              newConfig.disabledLocalBlockLists,
            );
          }
          if (generation === this.generation && profileChanged) {
            this.promptReload?.().catch((error: unknown) =>
              console.error('Error showing DNT reload dialog', error),
            );
          }
        });
      await this.reloadPromise;
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

      if (!isInjected()) {
        // Safe built-in equivalent for YouTube ad-response scriptlets.
        // Filter lists remain declarative: arbitrary ##+js rules never run.
        inject(contextBridge);
        await webFrame.executeJavaScript(this.script);
      }

      if (usesBlockLists(config.blocker, config.customEnabled)) {
        await injectCliqzPreload();
      }
    },
    async onConfigChange(newConfig) {
      if (!isInjected()) {
        inject(contextBridge);
        await webFrame.executeJavaScript(this.script);
      }
      if (usesBlockLists(newConfig.blocker, newConfig.customEnabled)) {
        await injectCliqzPreload();
      }
    },
  },
});
