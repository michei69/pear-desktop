// The native application menu, like pear-desktop's (src/menu.ts) without its
// Plugins and Options submenus: the settings dialog replaced those. The
// in-app-menu plugin draws this same menu in the page.

import { app, type BrowserWindow, clipboard, dialog, Menu, type MenuItemConstructorOptions, shell } from "electron";
import { type PluginMenuItem, stripMusicSubdomain, stripSIParam } from "@pear/sdk";
import type { Translate } from "@pear/sdk/i18n";
import { CUSTOM_PRESET, defaultPreset, keyLabel } from "@pear/sdk/themes";
import type { Themes } from "./themes.ts";
import type { UpdateChannel } from "./updates.ts";
import { alive } from "./windows.ts";

/** What the menu needs from the theme engine; tests pass a fake. */
export type MenuThemes = Pick<Themes, "all" | "selected" | "presets" | "select" | "setPreset" | "import" | "openFolder">;

export interface MenuEnvironment {
  platform: NodeJS.Platform;
  t: Translate;
  /** The YTM window. */
  window(): BrowserWindow | undefined;
  openSettings(): void;
  /** The theme folders, for the theme submenu. */
  themes: MenuThemes;
  /** Plugins' items (`ctx.addMenuItem`), below Settings. */
  pluginItems(): readonly PluginMenuItem[];
  alwaysOnTop(): boolean;
  setAlwaysOnTop(value: boolean): void;
  /** The open YTM page's language, for Language › Sync; both or the submenu is left out. */
  languageFromYtm?(): Promise<string | null>;
  languageToYtm?(): Promise<void>;
  /** Persists the app language (a restart applies it). */
  setLanguage?(language: string): void;
  /** Whether copying the current URL should drop `music.` and `si`. */
  shareLinkOptions?(): { stripMusic: boolean; stripSI: boolean };
  /** Only packaged builds have an update channel (and pass these). */
  updatesSupported?(): boolean;
  checkForUpdates?(): void;
  autoUpdates?(): boolean;
  setAutoUpdates?(value: boolean): void;
  updateChannel?(): UpdateChannel;
  setUpdateChannel?(value: UpdateChannel): void;
  /** config.json */
  settingsPath: string;
  restart(): void;
}

export const ALWAYS_ON_TOP_ID = "always-on-top";

type Contents = () => Electron.WebContents | undefined;

export function menuTemplate(env: MenuEnvironment): MenuItemConstructorOptions[] {
  const isMac = env.platform === "darwin";
  const contents = () => alive(env.window())?.webContents;
  const settings = settingsItem(env);
  const template = [optionsMenu(env, contents, isMac ? undefined : settings), viewMenu(env), navigationMenu(env, contents), aboutMenu(env)];
  return isMac ? [macAppMenu(settings), ...template] : template;
}

function settingsItem(env: MenuEnvironment): MenuItemConstructorOptions {
  return {
    id: "settings",
    label: env.t("main.menu.options.submenu.settings", "Settings…"),
    accelerator: "CmdOrCtrl+,",
    // The page handles the shortcut itself (it toggles the dialog).
    registerAccelerator: false,
    click: () => env.openSettings(),
  };
}

/** `settings` leads the menu, except on macOS where it is in the app menu; plugins' items follow. */
function optionsMenu(
  env: MenuEnvironment,
  contents: Contents,
  settings: MenuItemConstructorOptions | undefined,
): MenuItemConstructorOptions {
  const { t } = env;
  const leading = [...(settings ? [settings] : []), ...env.pluginItems().map(pluginItem)];
  return {
    label: t("main.menu.options.label", "Options"),
    submenu: [
      ...(leading.length > 0 ? [...leading, { type: "separator" } as const] : []),
      ...(env.updatesSupported?.() === true ? [updatesItem(env), { type: "separator" } as const] : []),
      {
        id: ALWAYS_ON_TOP_ID,
        label: t("main.menu.options.submenu.always-on-top", "Always on top"),
        type: "checkbox",
        checked: env.alwaysOnTop(),
        click: (item) => env.setAlwaysOnTop(item.checked),
      },
      ...(env.languageFromYtm && env.languageToYtm ? [languageSyncItem(env)] : []),
      { type: "separator" },
      {
        label: t("main.menu.options.submenu.visual-tweaks.submenu.theme.label", "Theme"),
        submenu: themeItems(env),
      },
      { type: "separator" },
      {
        label: t("main.menu.options.submenu.advanced-options.submenu.toggle-dev-tools", "Toggle DevTools"),
        accelerator: env.platform === "darwin" ? "Alt+Cmd+I" : "Ctrl+Shift+I",
        click: () => contents()?.toggleDevTools(),
      },
      {
        label: t("main.menu.options.submenu.advanced-options.submenu.edit-config-json", "Edit config.json"),
        click: () => void shell.openPath(env.settingsPath),
      },
    ],
  };
}

/** Updates: a manual check, automatic checks, and the release channel (stable/beta). */
function updatesItem(env: MenuEnvironment): MenuItemConstructorOptions {
  const { t } = env;
  return {
    label: t("main.menu.options.submenu.updates.label", "Updates"),
    submenu: [
      {
        label: t("main.menu.options.submenu.updates.check", "Check for updates"),
        click: () => env.checkForUpdates?.(),
      },
      { type: "separator" },
      {
        label: t("main.menu.options.submenu.updates.auto-update", "Automatically check for updates"),
        type: "checkbox",
        checked: env.autoUpdates?.() === true,
        click: (item) => env.setAutoUpdates?.(item.checked),
      },
      { type: "separator" },
      {
        label: t("main.menu.options.submenu.updates.channel.label", "Update channel"),
        submenu: (["stable", "beta"] as const).map((value): MenuItemConstructorOptions => ({
          label: t(`main.menu.options.submenu.updates.channel.${value}`, value === "stable" ? "Stable" : "Beta"),
          type: "radio",
          checked: env.updateChannel?.() === value,
          // The core confirms a downgrade from a beta build; a declined switch leaves the store alone.
          click: () => env.setUpdateChannel?.(value),
        })),
      },
    ],
  };
}

/** Language › Sync: read YTM's language into the app, or point YTM at the app's. */
function languageSyncItem(env: MenuEnvironment): MenuItemConstructorOptions {
  const { t } = env;
  const fromYtm = env.languageFromYtm;
  const toYtm = env.languageToYtm;
  const showDialog = async (options: Electron.MessageBoxOptions) => {
    const window = alive(env.window());
    return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
  };
  return {
    label: t("main.menu.options.submenu.language.submenu.sync.label", "Sync language"),
    submenu: [
      {
        label: t(
          "main.menu.options.submenu.language.submenu.sync.submenu.from-\u0079outube",
          "From \u0059\u006f\u0075\u0054\u0075\u0062\u0065",
        ),
        click: async () => {
          if (!fromYtm) return;
          const language = await fromYtm();
          if (!language) {
            const failure: Electron.MessageBoxOptions = {
              type: "warning",
              title: t("main.menu.options.submenu.language.submenu.sync.failure.dialog.title", "Language Not Changed"),
              message: t(
                "main.menu.options.submenu.language.submenu.sync.failure.dialog.message",
                "Language or locale does not exist in app yet.",
              ),
            };
            const window = alive(env.window());
            if (window) dialog.showMessageBoxSync(window, failure);
            else dialog.showMessageBoxSync(failure);
            return;
          }
          env.setLanguage?.(language);
          await showDialog({
            title: t("main.menu.options.submenu.language.dialog.title", "Language Changed"),
            message: t("main.menu.options.submenu.language.dialog.message", "Language will be changed after restart"),
          });
        },
      },
      {
        label: t(
          "main.menu.options.submenu.language.submenu.sync.submenu.to-\u0079outube",
          "To \u0059\u006f\u0075\u0054\u0075\u0062\u0065",
        ),
        click: () => void toYtm?.(),
      },
    ],
  };
}

function pluginItem({ label, accelerator, click }: PluginMenuItem): MenuItemConstructorOptions {
  return { label, ...(accelerator ? { accelerator } : {}), click: () => click() };
}

const themeError = (error: unknown) => console.error("Failed to change theme:", error);

/** Selecting a theme does not rebuild this menu; its radios update themselves, and presets are per theme. */
function themeItems(env: MenuEnvironment): MenuItemConstructorOptions[] {
  const { t, themes } = env;
  const all = themes.all;
  const selected = themes.selected;
  const presets = themes.presets;

  const presetMenus: MenuItemConstructorOptions[] = all
    .filter((theme) => Object.keys(theme.presets ?? {}).length > 0)
    .map((theme) => {
      const chosen = defaultPreset(theme.palette, theme.presets, presets[theme.id]);
      const pick = (preset: string) => themes.setPreset(theme.id, preset);
      return {
        label: theme.name,
        submenu: [
          // Even an empty `palette` gives a Default to offer; without one the first preset stands in.
          ...(theme.palette !== undefined
            ? [
                {
                  label: t("main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.presets.default", "Default"),
                  type: "radio" as const,
                  checked: chosen === "",
                  click: () => pick(""),
                },
              ]
            : []),
          ...Object.keys(theme.presets ?? {}).map((preset) => ({
            label: keyLabel(preset),
            type: "radio" as const,
            checked: chosen === preset,
            click: () => pick(preset),
          })),
          {
            label: t("main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.presets.custom", "Custom"),
            type: "radio" as const,
            checked: chosen === CUSTOM_PRESET,
            click: () => pick(CUSTOM_PRESET),
          },
        ],
      };
    });

  return [
    {
      label: t("main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.no-theme", "No theme"),
      type: "radio" as const,
      checked: selected === "",
      click: () => void themes.select("", env.window()).catch(themeError),
    },
    ...all.map((theme) => ({
      label: theme.name,
      ...(theme.description ? { toolTip: theme.description } : {}),
      type: "radio" as const,
      checked: selected === theme.id,
      click: () => void themes.select(theme.id, env.window()).catch(themeError),
    })),
    { type: "separator" },
    {
      label: t("main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.presets.label", "Presets"),
      enabled: presetMenus.length > 0,
      submenu: presetMenus,
    },
    { type: "separator" },
    {
      label: t("main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.import-css-file", "Import custom CSS file"),
      click: () => void themes.import(undefined, env.window()).catch(themeError),
    },
    {
      label: t("main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.open-themes-folder", "Open themes folder"),
      click: () => void themes.openFolder().catch(themeError),
    },
  ];
}

function viewMenu({ t }: MenuEnvironment): MenuItemConstructorOptions {
  return {
    label: t("main.menu.view.label", "View"),
    submenu: [
      { label: t("main.menu.view.submenu.reload", "Reload"), role: "reload" },
      { label: t("main.menu.view.submenu.force-reload", "Force Reload"), role: "forceReload" },
      { type: "separator" },
      // An item takes one accelerator; hidden twins make zooming work with or without
      // Shift held (Ctrl+= and Ctrl+Plus, Ctrl+- and Ctrl+Shift+-), as in pear-desktop.
      { label: t("main.menu.view.submenu.zoom-in", "Zoom In"), role: "zoomIn", accelerator: "CmdOrCtrl+=", visible: false },
      { label: t("main.menu.view.submenu.zoom-in", "Zoom In"), role: "zoomIn", accelerator: "CmdOrCtrl+Plus" },
      { label: t("main.menu.view.submenu.zoom-out", "Zoom Out"), role: "zoomOut", accelerator: "CmdOrCtrl+-" },
      { label: t("main.menu.view.submenu.zoom-out", "Zoom Out"), role: "zoomOut", accelerator: "CmdOrCtrl+Shift+-", visible: false },
      { label: t("main.menu.view.submenu.reset-zoom", "Actual Size"), role: "resetZoom" },
      { type: "separator" },
      { label: t("main.menu.view.submenu.toggle-fullscreen", "Toggle Full Screen"), role: "togglefullscreen" },
    ],
  };
}

function navigationMenu(env: MenuEnvironment, contents: Contents): MenuItemConstructorOptions {
  const { t } = env;
  return {
    label: t("main.menu.navigation.label", "Navigation"),
    submenu: [
      {
        label: t("main.menu.navigation.submenu.go-back", "Go back"),
        click: () => {
          const history = contents()?.navigationHistory;
          if (history?.canGoBack()) history.goBack();
        },
      },
      {
        label: t("main.menu.navigation.submenu.go-forward", "Go forward"),
        click: () => {
          const history = contents()?.navigationHistory;
          if (history?.canGoForward()) history.goForward();
        },
      },
      {
        label: t("main.menu.navigation.submenu.copy-current-url", "Copy current URL"),
        click: () => {
          let url = contents()?.getURL();
          if (!url) return;
          const { stripMusic, stripSI } = env.shareLinkOptions?.() ?? { stripMusic: false, stripSI: false };
          if (stripMusic) url = stripMusicSubdomain(url);
          if (stripSI) url = stripSIParam(url);
          clipboard.writeText(url);
        },
      },
      { label: t("main.menu.navigation.submenu.restart", "Restart App"), click: () => env.restart() },
      { label: t("main.menu.navigation.submenu.quit", "Exit"), role: "quit" },
    ],
  };
}

function aboutMenu({ t }: MenuEnvironment): MenuItemConstructorOptions {
  return { label: t("main.menu.about", "About"), submenu: [{ role: "about" }] };
}

function macAppMenu(settings: MenuItemConstructorOptions): MenuItemConstructorOptions {
  return {
    label: app.name,
    submenu: [
      { role: "about" },
      { type: "separator" },
      settings,
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "selectAll" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { type: "separator" },
      { role: "minimize" },
      { role: "close" },
      { role: "quit" },
    ],
  };
}

export function setApplicationMenu(env: MenuEnvironment) {
  const menu = Menu.buildFromTemplate(menuTemplate(env));
  Menu.setApplicationMenu(menu);
  return menu;
}

/** Keeps the menu's checkbox in step when the option changes elsewhere (settings, API). */
export function syncMenu(alwaysOnTop: boolean) {
  const item = Menu.getApplicationMenu()?.getMenuItemById(ALWAYS_ON_TOP_ID);
  if (item) item.checked = alwaysOnTop;
}

/** window.hideMenu: the menu bar hides and Alt shows it (Linux and Windows; macOS has a global menu bar). */
export function applyHideMenu(window: BrowserWindow, hide: boolean) {
  window.setAutoHideMenuBar(hide);
  window.setMenuBarVisibility(!hide);
}
