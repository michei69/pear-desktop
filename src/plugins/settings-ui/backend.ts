import { BrowserWindow, dialog, shell, type OpenDialogOptions } from 'electron';

import * as config from '@/config';
import { t } from '@/i18n';
import { restart } from '@/providers/app-controls';
import { getAppMeta } from '@/providers/app-meta';
import { checkForAppUpdates, setUpdateChannel } from '@/providers/app-updates';
import { flagMetadata } from '@/providers/flag-metadata';
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
import { NEW_UI_PROBE } from '@/utils/new-ui';

import type { SettingsUIConfig } from './index';

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
  'ytmd-sui:flag-metadata',
  'ytmd-sui:new-ui',
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
      FLAG_METADATA,
      NEW_UI,
      OPEN_WINDOW,
    ] = CHANNELS;

    ipc.handle(LOAD_STORE, () => config.getStore());

    // False when the write was refused (declining a theme's script), so the
    // caller re-reads the store instead of keeping its optimistic value.
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

        // Flag overrides take effect live, so they bypass setMenuOption, whose
        // restartOnConfigChanges would restart the app under the user.
        if (key === 'options.featureFlags') {
          if (!value || typeof value !== 'object') return false;
          config.set(key, value);
          return true;
        }

        // setMenuOption, not set: the native menu honours `restartOnConfigChanges`
        // for these same options, so the two paths must not diverge.
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
    ipc.handle(APP_META, () => getAppMeta());

    ipc.handle(OPEN_EXTERNAL, async (url: string) => {
      try {
        const { protocol } = new URL(url);
        if (protocol === 'https:' || protocol === 'http:') {
          await shell.openExternal(url);
        }
      } catch {}
    });

    // Routed through the provider: the check follows the selected channel, and a
    // dev build gets the commit comparison instead.
    ipc.handle(CHECK_UPDATES, () => checkForAppUpdates());

    // False when the user declined the downgrade warning or the value was not a
    // channel; the renderer then re-reads the store instead of keeping its pick.
    ipc.handle(UPDATE_CHANNEL_SET, (channel: string) =>
      setUpdateChannel(channel),
    );

    // Themes: the state the renderer applies, plus the modal's palette edits.
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

    // Descriptions, families and restart requirements for the flags section.
    // Resolves once the launch download has finished, so the first open shows
    // them instead of an empty list.
    ipc.handle(FLAG_METADATA, () => flagMetadata());

    // The new-UI state lives in the main window's page, which the standalone
    // settings window does not have: probe it there so both show the same fields.
    ipc.handle(NEW_UI, async (): Promise<boolean> => {
      // The main window, by the URL it loads; the settings window is a file.
      const urls = [config.get('url'), config.defaultConfig.url];
      const main = BrowserWindow.getAllWindows().find(
        (win) =>
          !win.isDestroyed() &&
          urls.some((url) => win.webContents.getURL().startsWith(url)),
      );
      if (!main) return false;

      return Boolean(await main.webContents.executeJavaScript(NEW_UI_PROBE));
    });

    // The renderer picks the presentation; the window can only be made here.
    // Reopening focuses the existing one.
    ipc.handle(OPEN_WINDOW, () => {
      openSettingsWindow();
    });

    this.unwatch = config.watch(() => {
      const store = config.getStore();
      // Broadcast to every window: the injected modal is in the main window, the
      // standalone tray window is a separate BrowserWindow that must stay in sync.
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
