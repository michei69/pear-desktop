// The core settings sections the app applies itself (the API server applies
// its own): their state for the settings UI and the page, and the options that
// take effect live.

import { app, dialog } from "electron";
import type { CoreSection } from "@pear/sdk/core-config";
import type { Translate } from "@pear/sdk/i18n";
import type { CoreState } from "@pear/sdk/protocol";
import type { Settings } from "./config.ts";
import { type MainWindow, windowTitle } from "./main-window.ts";
import { applyHideMenu, syncMenu } from "./menu.ts";
import { Themes } from "./themes.ts";
import { isBetaVersion } from "./version.ts";
import { alive } from "./windows.ts";

export type AppSection = Exclude<CoreSection, "apiServer">;

export interface CoreOptionsEnvironment {
  /** The update manager, for an immediate check after a channel or auto-updates change. */
  updates?: { channelChanged(): void };
  /** Rebuilds the native menu, whose radios and checkboxes mirror these options. */
  refreshMenu?(): void;
}

export class CoreOptions {
  readonly themes: Themes;
  #settings: Settings;
  #mainWindow: MainWindow;
  #t: Translate;
  #env: CoreOptionsEnvironment;

  constructor(
    settings: Settings,
    t: Translate,
    mainWindow: MainWindow,
    onThemesImported: () => void,
    environment: CoreOptionsEnvironment = {},
  ) {
    this.#settings = settings;
    this.#mainWindow = mainWindow;
    this.#t = t;
    this.#env = environment;
    this.themes = new Themes(
      settings,
      t,
      () => {
        mainWindow.send({ type: "themes", state: this.themes.state() });
      },
      onThemesImported,
    );
  }

  /** Reads, migrates and watches the theme folders. */
  start() {
    this.themes.start();
  }

  stop() {
    this.themes.stop();
  }

  /** A section's state for the settings UI and the page. */
  state(section: AppSection): CoreState {
    return { config: this.#settings.core(section) };
  }

  states(): Record<AppSection, CoreState> {
    return {
      general: this.state("general"),
      window: this.state("window"),
      appearance: this.state("appearance"),
      advanced: this.state("advanced"),
      site: this.state("site"),
    };
  }

  /** Applies the options that take effect live. */
  apply(section: CoreSection) {
    if (section === "window") this.#applyWindow();
    else if (section === "appearance") this.#applyAppearance();
  }

  /** Changes options like the settings UI does (and tells it); a declined beta→stable switch changes nothing. */
  async set(section: AppSection, patch: Record<string, unknown>) {
    if (section === "general" && patch.updateChannel === "stable") {
      const current = this.#settings.core("general").updateChannel;
      if (current !== "stable" && isBetaVersion(app.getVersion()) && !(await this.#confirmDowngrade())) return;
    }
    const previous = section === "general" ? this.#settings.core("general") : undefined;
    this.#settings.setCore(section, patch);
    this.apply(section);
    this.#mainWindow.send({ type: "core-state", section, state: this.state(section) });
    if (!previous) return;
    const next = this.#settings.core("general");
    if (previous.updateChannel === next.updateChannel && previous.autoUpdates === next.autoUpdates) return;
    // The update manager checks on the new channel right away; the menu mirrors the new values.
    this.#env.updates?.channelChanged();
    this.#env.refreshMenu?.();
  }

  /** Warns before a beta build switches to stable: a downgrade runs no migrations back. */
  async #confirmDowngrade() {
    const options: Electron.MessageBoxOptions = {
      type: "warning",
      buttons: [
        this.#t("main.dialog.downgrade-warning.cancel", "Cancel"),
        this.#t("main.dialog.downgrade-warning.confirm", "Switch to stable"),
      ],
      title: this.#t("main.dialog.downgrade-warning.title", "Switch back to stable?"),
      message: this.#t("main.dialog.downgrade-warning.message", "This beta build is newer than the latest stable release."),
      detail: this.#t(
        "main.dialog.downgrade-warning.detail",
        "Switching back can reset some settings: going from a newer version to an older one runs no migrations and can leave newer settings unreadable.",
      ),
      defaultId: 0,
      cancelId: 0,
    };
    const window = alive(this.#mainWindow.window);
    const { response } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
    return response === 1;
  }

  #applyWindow() {
    const options = this.#settings.core("window");
    syncMenu(options.alwaysOnTop);
    const window = this.#mainWindow.window;
    if (!window) return;
    window.setAlwaysOnTop(options.alwaysOnTop);
    if (process.platform !== "darwin") applyHideMenu(window, options.hideMenu);
    if (process.platform === "win32" || process.platform === "darwin") {
      app.setLoginItemSettings({ openAtLogin: options.startAtLogin, args: [] });
    }
  }

  #applyAppearance() {
    // The page applies the rest itself (core-state events).
    const window = this.#mainWindow.window;
    if (window) window.setTitle(windowTitle(this.#settings, window));
  }
}
