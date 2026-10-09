import os from 'node:os';

import {
  app,
  BrowserWindow,
  dialog,
  shell,
  type OpenDialogOptions,
} from 'electron';

import { buildLabel, copyright } from '@/app-info';
import * as config from '@/config';
import { t } from '@/i18n';
import { restart } from '@/providers/app-controls';
import { checkForAppUpdates, setUpdateChannel } from '@/providers/app-updates';
import { setYouTubeLanguage, youtubeLanguage } from '@/providers/language-sync';
import { applyOptionEffects } from '@/providers/option-effects';
import { openSettingsWindow } from '@/settings-window';
import {
  createThemeFromCssFiles,
  notifyThemesChanged,
  openThemesFolder,
  resetThemePalette,
  selectTheme,
  setThemePaletteValue,
  setThemePreset,
  themePaletteLayers,
  themesForRenderer,
} from '@/themes/main';
import { createBackend } from '@/utils';

import type { SettingsUIConfig } from './index';

/** Subset of chromium's GPUInfo that the debug info cares about. */
interface GpuInfo {
  auxAttributes?: {
    driverVersion?: string;
    glRenderer?: string;
    glVendor?: string;
    softwareRendering?: boolean;
  };
  gpuDevice?: {
    active?: boolean;
    deviceId?: number;
    deviceString?: string;
    driverVendor?: string;
    driverVersion?: string;
    vendorId?: number;
    vendorString?: string;
  }[];
}

/** Vendor ids, for when chromium has no name for the card. */
const GPU_VENDORS: Record<number, string> = {
  0x1002: 'AMD',
  0x1022: 'AMD',
  0x106b: 'Apple',
  0x10de: 'NVIDIA',
  0x13b5: 'ARM',
  0x5143: 'Qualcomm',
  0x8086: 'Intel',
};

/**
 * A readable GPU name. `complete` gives chromium's renderer string, which is
 * what chrome://gpu shows; the bus ids are the fallback when it does not.
 */
const describeGpu = (info: GpuInfo) => {
  const devices = info.gpuDevice ?? [];
  const device = devices.find((entry) => entry.active) ?? devices[0];

  const named = [device?.vendorString, device?.deviceString]
    .filter(Boolean)
    .join(' ');
  const ids = [
    GPU_VENDORS[device?.vendorId ?? 0] ?? 'GPU',
    device?.deviceId ? `0x${device.deviceId.toString(16)}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    renderer:
      info.auxAttributes?.glRenderer ||
      named ||
      (device ? ids : '') ||
      (info.auxAttributes?.softwareRendering
        ? 'software rendering'
        : undefined),
    vendor: info.auxAttributes?.glVendor ?? device?.driverVendor,
    driver: device?.driverVersion || info.auxAttributes?.driverVersion,
  };
};

/** Every channel the modal calls, so `stop` can unregister them all. */
const CHANNELS = [
  'ytmd-sui:load-store',
  'ytmd-sui:option-set',
  'ytmd-sui:plugin-toggle',
  'ytmd-sui:pick-path',
  'ytmd-sui:config-edit',
  'ytmd-sui:toggle-devtools',
  'ytmd-sui:restart',
  'ytmd-sui:app-meta',
  'ytmd-sui:open-external',
  'ytmd-sui:check-updates',
  'ytmd-sui:update-channel-set',
  'ytmd-sui:themes',
  'ytmd-sui:theme-color-set',
  'ytmd-sui:theme-preset-set',
  'ytmd-sui:theme-colors-reset',
  'ytmd-sui:import-theme-css',
  'ytmd-sui:open-themes-folder',
  'ytmd-sui:language-from-youtube',
  'ytmd-sui:language-to-youtube',
  'ytmd-sui:open-window',
] as const;

export const backend = createBackend<
  { unwatch?: () => void },
  SettingsUIConfig
>({
  start(ctx) {
    const { ipc, window } = ctx;
    const [
      LOAD_STORE,
      OPTION_SET,
      PLUGIN_TOGGLE,
      PICK_PATH,
      CONFIG_EDIT,
      TOGGLE_DEVTOOLS,
      RESTART,
      APP_META,
      OPEN_EXTERNAL,
      CHECK_UPDATES,
      UPDATE_CHANNEL_SET,
      THEMES,
      THEME_COLOR_SET,
      THEME_PRESET_SET,
      THEME_COLORS_RESET,
      IMPORT_THEME_CSS,
      OPEN_THEMES_FOLDER,
      LANGUAGE_FROM_YOUTUBE,
      LANGUAGE_TO_YOUTUBE,
      OPEN_WINDOW,
    ] = CHANNELS;

    ipc.handle(LOAD_STORE, () => config.getStore());

    // Returns false when the write was refused (declining a theme's script),
    // so the caller can re-read the store instead of keeping its optimistic value.
    ipc.handle(
      OPTION_SET,
      async (key: string, value: unknown): Promise<boolean> => {
        if (typeof key !== 'string' || !key) return false;

        if (key === 'options.theme') {
          if (typeof value !== 'string') return false;
          if (!(await selectTheme(value, window))) return false;
          notifyThemesChanged(window);
          return true;
        }

        // setMenuOption, not set: the native menu offers these same options and
        // honours `restartOnConfigChanges`, so the two paths must not diverge.
        config.setMenuOption(key, value);
        applyOptionEffects(key, value, window);
        return true;
      },
    );

    ipc.handle(PLUGIN_TOGGLE, (id: string, enabled: boolean) => {
      if (typeof id !== 'string' || !id || typeof enabled !== 'boolean') return;
      if (enabled) config.plugins.enable(id);
      else config.plugins.disable(id);
    });

    ipc.handle(
      PICK_PATH,
      async (options: OpenDialogOptions): Promise<string | undefined> => {
        const result = await dialog.showOpenDialog(window, options);
        return result.canceled ? undefined : result.filePaths[0];
      },
    );

    ipc.handle(CONFIG_EDIT, () => config.edit());
    ipc.handle(TOGGLE_DEVTOOLS, () => window.webContents.toggleDevTools());
    ipc.handle(RESTART, () => restart());
    ipc.handle(APP_META, async () => {
      const metrics = app.getAppMetrics();
      const workingSet = (type: string) =>
        metrics
          .filter((metric) => metric.type === type)
          .reduce((total, metric) => total + metric.memory.workingSetSize, 0);

      // Kilobytes, as Electron reports them. The Browser entry is the app's own
      // node process, and whatever is left is the chromium renderers, whatever
      // Electron happens to call them.
      const main =
        workingSet('Browser') || Math.round(process.memoryUsage().rss / 1024);
      const known = new Set(['Browser', 'GPU']);
      const renderers = metrics
        .filter((metric) => !known.has(metric.type))
        .reduce((total, metric) => total + metric.memory.workingSetSize, 0);

      const cpus = os.cpus();

      let gpu: GpuInfo = {};
      try {
        // Rejects when the GPU is entirely disabled, so keep whatever we have:
        // the feature status still says whether that is the case.
        gpu = (await app.getGPUInfo('complete')) as GpuInfo;
      } catch {}

      return {
        name: app.getName(),
        version: app.getVersion(),
        build: buildLabel(),
        copyright,
        platform: process.platform,
        arch: process.arch,
        osVersion: `${os.type()} ${os.release()}`,
        versions: {
          electron: process.versions.electron,
          chrome: process.versions.chrome,
          node: process.versions.node,
        },
        cpu: {
          model: cpus[0]?.model.trim() ?? 'unknown',
          threads: cpus.length,
        },
        gpu: {
          ...describeGpu(gpu),
          features: { ...app.getGPUFeatureStatus() },
        },
        memory: { main, renderers, gpu: workingSet('GPU') },
      };
    });

    ipc.handle(OPEN_EXTERNAL, async (url: string) => {
      try {
        const { protocol } = new URL(url);
        if (protocol === 'https:' || protocol === 'http:') {
          await shell.openExternal(url);
        }
      } catch {}
    });

    // Routed through the provider so the check follows the selected channel
    // and a dev build gets the commit comparison instead.
    ipc.handle(CHECK_UPDATES, () => checkForAppUpdates());

    // False when the user declined the downgrade warning, or the value was not
    // a channel; the renderer then re-reads the store instead of keeping its
    // optimistic pick.
    ipc.handle(UPDATE_CHANNEL_SET, (channel: string) =>
      setUpdateChannel(channel),
    );

    // Themes: the same state the renderer applies, plus the edits the modal's
    // palette editor makes.
    ipc.handle(THEMES, () => ({
      themes: themesForRenderer(),
      selected: config.get('options.theme'),
      overrides: themePaletteLayers(),
    }));

    ipc.handle(
      THEME_COLOR_SET,
      (themeId: string, key: string, value: string) => {
        if (!themeId || !key || typeof value !== 'string') return;
        setThemePaletteValue(themeId, key, value);
        notifyThemesChanged(window);
      },
    );

    ipc.handle(THEME_PRESET_SET, (themeId: string, preset: string) => {
      if (!themeId || typeof preset !== 'string') return;
      setThemePreset(themeId, preset);
      notifyThemesChanged(window);
    });

    ipc.handle(THEME_COLORS_RESET, (themeId: string) => {
      if (!themeId) return;
      resetThemePalette(themeId);
      notifyThemesChanged(window);
    });

    ipc.handle(IMPORT_THEME_CSS, async (paths: string[]) => {
      const id = createThemeFromCssFiles(Array.isArray(paths) ? paths : []);
      if (!id) return;

      // Imported themes carry no script, so there is nothing to consent to.
      config.set('options.theme', id);
      notifyThemesChanged(window);

      // The native menu lists themes too; rebuild it outside this handler.
      const { refreshMenu } = await import('@/menu');
      await refreshMenu(window);
    });

    ipc.handle(OPEN_THEMES_FOLDER, () => openThemesFolder());

    // The menu's Language > Sync entries, so the modal can offer them too.
    ipc.handle(LANGUAGE_FROM_YOUTUBE, async () => {
      const language = await youtubeLanguage(window);

      if (!language) {
        dialog.showMessageBoxSync(window, {
          title: t(
            'main.menu.options.submenu.language.submenu.sync.failure.dialog.title',
          ),
          message: t(
            'main.menu.options.submenu.language.submenu.sync.failure.dialog.message',
          ),
        });
      }

      return language;
    });

    ipc.handle(LANGUAGE_TO_YOUTUBE, () =>
      setYouTubeLanguage(window, config.get('options.language') ?? 'en'),
    );

    // The renderer decides which presentation to use; the window itself can
    // only be made here. Reopening focuses the existing one.
    ipc.handle(OPEN_WINDOW, () => {
      openSettingsWindow();
    });

    this.unwatch = config.watch(() => {
      const store = config.getStore();
      // Broadcast to every window: the injected modal lives in the main
      // window, but the standalone tray settings window is a separate
      // BrowserWindow that must also stay in sync.
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('ytmd-sui:store-changed', store);
        }
      }
    });
  },

  stop(ctx) {
    this.unwatch?.();
    this.unwatch = undefined;

    for (const channel of CHANNELS) ctx.ipc.removeHandler(channel);
  },
});
