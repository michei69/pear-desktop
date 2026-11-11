// The native application menu, like pear-desktop's (src/menu.ts), with a
// focused Options submenu. The in-app-menu plugin draws this same menu in the
// page.

import { app, type BrowserWindow, clipboard, Menu, type MenuItemConstructorOptions, shell } from "electron";
import { type PluginMenuItem, stripMusicSubdomain, stripSIParam } from "@pear/sdk";
import { type ApiServerConfig, type CoreSection } from "@pear/sdk/core-config";
import type { Translate } from "@pear/sdk/i18n";
import type { Themes } from "./themes.ts";
import type { UpdateChannel } from "./updates.ts";
import { alive } from "./windows.ts";

/** What the menu needs from the theme engine; tests pass a fake. */
export type MenuThemes = Pick<Themes, "all" | "selected" | "presets" | "select" | "setPreset" | "import" | "openFolder">;

/** The API server's options, and the write path that applies them (it rebinds itself). */
export interface ApiServerMenu {
  config: ApiServerConfig;
  set(patch: Partial<ApiServerConfig>): void;
}

/** A plugin as the Plugins menu lists it. */
export interface MenuPlugin {
  id: string;
  name: string;
  enabled: boolean;
}

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
  /** The plugins the Plugins menu toggles; without it (or an empty catalog) the menu is left out. */
  pluginCatalog?(): readonly MenuPlugin[];
  setPluginEnabled?(id: string, enabled: boolean): void;
  /** The API server's menu (pear-desktop's plugin submenu); left out while the host doesn't expose it. */
  apiServer?(): ApiServerMenu | undefined;
  /** A core option the Options menu mirrors (the settings window writes the same key). */
  coreOption?(section: CoreSection, key: string): unknown;
  setCoreOption?(section: CoreSection, patch: Record<string, unknown>): void;
  /** pear-desktop's "restart on config changes": every settings change relaunches the app. */
  restartOnConfigChanges?(): boolean;
  setRestartOnConfigChanges?(value: boolean): void;
  alwaysOnTop(): boolean;
  setAlwaysOnTop(value: boolean): void;
  /** Whether this instance holds the single-instance lock (another launch then focuses it). */
  singleInstanceLock(): boolean;
  setSingleInstanceLock(value: boolean): void;
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
  const plugins = pluginsMenu(env);
  const template = [
    ...(plugins ? [plugins] : []),
    optionsMenu(env, contents, isMac ? undefined : settings),
    viewMenu(env),
    navigationMenu(env, contents),
    aboutMenu(env),
  ];
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

/** A checkbox for a boolean core option; omitted while the host doesn't expose the option. */
function coreCheckbox(
  env: MenuEnvironment,
  section: CoreSection,
  key: string,
  labelKey: string,
  label: string,
): MenuItemConstructorOptions | undefined {
  const value = env.coreOption?.(section, key);
  if (value === undefined) return undefined;
  return {
    label: env.t(labelKey, label),
    type: "checkbox",
    checked: value === true,
    click: (item) => env.setCoreOption?.(section, { [key]: item.checked }),
  };
}

/** Drops the entries the environment doesn't expose, and separators left doubled. */
function entries(...items: (MenuItemConstructorOptions | undefined)[]): MenuItemConstructorOptions[] {
  const visible: MenuItemConstructorOptions[] = [];
  for (const item of items) {
    if (!item) continue;
    if (item.type === "separator" && visible.at(-1)?.type === "separator") continue;
    visible.push(item);
  }
  return visible;
}

/** pear-desktop's Plugins menu: one enable/disable checkbox per plugin, like the settings cards. */
function pluginsMenu(env: MenuEnvironment): MenuItemConstructorOptions | undefined {
  const catalog = env.pluginCatalog?.();
  if (!catalog || catalog.length === 0 || !env.setPluginEnabled) return undefined;
  return {
    label: env.t("main.menu.plugins.label", "Plugins"),
    submenu: [...catalog]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((plugin) => ({
        label: plugin.name,
        type: "checkbox" as const,
        checked: plugin.enabled,
        click: (item: Electron.MenuItem) => env.setPluginEnabled?.(plugin.id, item.checked),
      })),
  };
}

/** pear-desktop's Advanced options submenu: the advanced switches plus DevTools and config.json. */
function advancedOptionsItem(env: MenuEnvironment, contents: Contents): MenuItemConstructorOptions {
  const { t } = env;
  return {
    label: t("main.menu.options.submenu.advanced-options.label", "Advanced options"),
    submenu: entries(
      coreCheckbox(
        env,
        "advanced",
        "overrideUserAgent",
        "main.menu.options.submenu.advanced-options.submenu.override-user-agent",
        "Override the user agent",
      ),
      coreCheckbox(
        env,
        "advanced",
        "disableHardwareAcceleration",
        "main.menu.options.submenu.advanced-options.submenu.disable-hardware-acceleration",
        "Disable hardware acceleration",
      ),
      {
        label: t("main.menu.options.submenu.advanced-options.submenu.restart-on-config-changes", "Restart on config changes"),
        type: "checkbox",
        checked: env.restartOnConfigChanges?.() === true,
        click: (item) => env.setRestartOnConfigChanges?.(item.checked),
      },
      coreCheckbox(
        env,
        "advanced",
        "autoResetAppCache",
        "main.menu.options.submenu.advanced-options.submenu.auto-reset-app-cache",
        "Clear the app cache on startup",
      ),
      env.platform === "win32"
        ? coreCheckbox(
            env,
            "window",
            "forceSmtc",
            "main.menu.options.submenu.advanced-options.submenu.force-smtc",
            "Force the use of external SMTC",
          )
        : undefined,
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
    ),
  };
}

/** The only plugin item Options keeps; plugins keep their settings cards. */
function downloadsItem(env: MenuEnvironment): MenuItemConstructorOptions | undefined {
  const label = env.t("plugins.downloader.downloads", "Downloads");
  const item = env.pluginItems().find((candidate) => candidate.label === label);
  return item ? pluginItem(item) : undefined;
}

/**
 * The resume-shuffle plugin's switch, shown under Options as "Keep shuffle".
 * It is a plugin toggle rather than a core setting, so it goes through the
 * same enable/disable path as the Plugins menu and the settings cards.
 */
function keepShuffleItem(env: MenuEnvironment): MenuItemConstructorOptions | undefined {
  const plugin = env.pluginCatalog?.().find((candidate) => candidate.id === "resume-shuffle");
  if (!plugin || !env.setPluginEnabled) return undefined;
  return {
    label: env.t("main.menu.options.submenu.keep-shuffle", "Keep shuffle"),
    type: "checkbox",
    checked: plugin.enabled,
    click: (item) => env.setPluginEnabled?.("resume-shuffle", item.checked),
  };
}

/** `settings` leads the menu, except on macOS where it is in the app menu. */
function optionsMenu(
  env: MenuEnvironment,
  contents: Contents,
  settings: MenuItemConstructorOptions | undefined,
): MenuItemConstructorOptions {
  const { t } = env;
  const leading = entries(settings, downloadsItem(env));
  const quick = entries(
    coreCheckbox(env, "general", "resumeOnStart", "main.menu.options.submenu.resume-on-start", "Resume the last song"),
    keepShuffleItem(env),
  );
  return {
    label: t("main.menu.options.label", "Options"),
    submenu: entries(
      ...leading,
      ...(leading.length > 0 ? [{ type: "separator" } as const] : []),
      ...quick,
      ...(quick.length > 0 ? [{ type: "separator" } as const] : []),
      {
        // As pear-desktop: a second launch focuses this instance only while the lock is held.
        label: t("main.menu.options.submenu.single-instance-lock", "Single Instance Lock"),
        type: "checkbox",
        checked: env.singleInstanceLock(),
        click: (item) => env.setSingleInstanceLock(item.checked),
      },
      {
        id: ALWAYS_ON_TOP_ID,
        label: t("main.menu.options.submenu.always-on-top", "Always on top"),
        type: "checkbox",
        checked: env.alwaysOnTop(),
        click: (item) => env.setAlwaysOnTop(item.checked),
      },
      { type: "separator" },
      advancedOptionsItem(env, contents),
    ),
  };
}

function pluginItem({ label, accelerator, click }: PluginMenuItem): MenuItemConstructorOptions {
  return { label, ...(accelerator ? { accelerator } : {}), click: () => click() };
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
