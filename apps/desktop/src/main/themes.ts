// The user's themes: folders under <userData>/themes, watched so edits show up
// live. The host reads them (the page can't read files), gates a theme's script
// on the user's consent to its exact SHA-256, and tells the page its state.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { app, type BrowserWindow, dialog, shell } from "electron";
import type { Translate } from "@pear/sdk/i18n";
import {
  CUSTOM_PRESET,
  parseManifest,
  presetPalette,
  type PearTheme,
  type ThemeManifest,
  type ThemePalette,
  type ThemeState,
} from "@pear/sdk/themes";
import basicCss from "./basic-theme.css?inline";
import type { Settings } from "./config.ts";
import { isJsConsented, MANIFEST_FILE, readThemesFrom } from "./theme-load.ts";

/**
 * Palette for the theme seeded on first run, kept identical to the old built-in
 * default so an install with no authored themes is unchanged.
 */
const DEFAULT_PALETTE: ThemePalette = {
  accent: "#ff0000",
  background: "#030303",
  surface: "#1f1f1f",
  text: "#ffffff",
};

const BASIC_THEME_ID = "basic";
const BASIC_CSS_FILE = "style.css";
/** Theme folders are re-read this often; a few files, so polling is cheap and survives editors. */
const POLL_MS = 1000;

const getThemesDir = () => join(app.getPath("userData"), "themes");

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "theme";

/** A theme without its script, for when consent to the current hash is missing. */
const withoutScript = (theme: PearTheme): PearTheme => {
  const { js: _js, ...rest } = theme;
  return { ...rest, jsBlocked: true };
};

/**
 * Ensures the user has consented to `theme`'s script, prompting if it is new or
 * changed since they last agreed. Returns false if the user declined, in which
 * case the caller must not switch to the theme.
 */
async function ensureJsConsent(theme: PearTheme, t: Translate, win?: BrowserWindow): Promise<boolean> {
  if (!theme.js) return true;

  const options: Electron.MessageBoxOptions = {
    type: "warning",
    // Refuse rather than default to running unvetted code.
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: t("main.themes.consent.title", "Run theme code?"),
    message: t("main.themes.consent.message", '"{{theme}}" contains a script that will run with full access to the app.', {
      theme: theme.name,
    }),
    detail: t(
      "main.themes.consent.detail",
      "Theme scripts are not sandboxed. This code can read and change your settings, talk to the app, and do anything else the app itself can do. Only allow this if you trust where the theme came from. You can revoke this by removing the theme.",
    ),
    buttons: [t("main.themes.consent.allow", "Run this theme"), t("main.themes.consent.cancel", "Cancel")],
  };

  // Attach the dialog to the window when we have one; at startup it stands alone.
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  return response === 0;
}

const writeManifest = (folder: string, manifest: Required<Pick<ThemeManifest, "name">> & ThemeManifest) => {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
};

const copyCssFiles = (folder: string, paths: string[]): string[] => {
  mkdirSync(folder, { recursive: true });
  return paths.map((path, index) => {
    const fileName = paths.length === 1 ? "style.css" : `${index + 1}-${basename(path)}`;
    copyFileSync(path, join(folder, fileName));
    return fileName;
  });
};

const uniqueThemeDir = (name: string): { id: string; folder: string } => {
  const dir = getThemesDir();
  const base = slugify(name);
  let id = base;
  for (let n = 2; existsSync(join(dir, id)); n++) id = `${base}-${n}`;
  return { id, folder: join(dir, id) };
};

/** Writes the Basic theme's stylesheet and points its manifest at it. */
const writeBasicTheme = (folder: string, manifest: Omit<ThemeManifest, "css"> & { name: string }) => {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, BASIC_CSS_FILE), basicCss);
  writeManifest(folder, { ...manifest, css: BASIC_CSS_FILE });
};

const seedBasicTheme = () => {
  const { folder } = uniqueThemeDir(BASIC_THEME_ID);
  if (existsSync(join(folder, MANIFEST_FILE))) return;

  writeBasicTheme(folder, {
    name: "Basic",
    description: "Recolours \u0059\u006f\u0075\u0054\u0075\u0062\u0065 Music from a four-colour palette you can edit.",
    author: "pear-desktop",
    palette: DEFAULT_PALETTE,
  });
};

/**
 * Installs seeded before the recolour moved into the theme have a palette but no
 * CSS, so give them the stylesheet, keeping the rest of the manifest. A Basic
 * theme with its own CSS is left alone, and a deleted one is not re-created.
 */
const upgradeBasicTheme = () => {
  const folder = join(getThemesDir(), BASIC_THEME_ID);
  const manifestPath = join(folder, MANIFEST_FILE);
  if (!existsSync(manifestPath)) return;

  const manifest = parseManifest(readFileSync(manifestPath, "utf8"));
  const declared = manifest?.css;
  // The old seed wrote `"css": []`, so an empty list means "no CSS yet".
  const hasOwnCss = Array.isArray(declared) ? declared.length > 0 : Boolean(declared);
  if (!manifest || hasOwnCss) return;

  writeBasicTheme(folder, { ...manifest, name: manifest.name ?? "Basic" });
};

/** Asks for CSS files to import; empty when the user cancels. */
async function pickCssFiles(win?: BrowserWindow): Promise<string[]> {
  const options: Electron.OpenDialogOptions = {
    filters: [{ name: "CSS Files", extensions: ["css"] }],
    properties: ["openFile", "multiSelections"],
  };
  const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return canceled ? [] : filePaths;
}

/** The theme engine: what the page applies, and the edits the UI and menu make. */
export class Themes {
  #settings: Settings;
  #t: Translate;
  #onChange: () => void;
  #onCatalogChange: () => void;
  #themes: PearTheme[] = [];
  #signature = "";
  #timer: ReturnType<typeof setInterval> | undefined;

  /**
   * `onChange` runs when the folders or the selection change; `onCatalogChange`
   * only when a theme folder was added, so the native menu can list it.
   */
  constructor(settings: Settings, t: Translate, onChange: () => void, onCatalogChange: () => void) {
    this.#settings = settings;
    this.#t = t;
    this.#onChange = onChange;
    this.#onCatalogChange = onCatalogChange;
  }

  /** The theme folders as last read, scripts included. */
  get all(): readonly PearTheme[] {
    return this.#themes;
  }

  /** Selected theme id, or '' for no theme. */
  get selected(): string {
    return this.#settings.themeConfig().theme;
  }

  /** Preset picks by theme id, for the menu's check marks. */
  get presets(): Record<string, string> {
    return this.#settings.themeConfig().themePresets;
  }

  /** Reads the folders, migrates and seeds once, then watches for edits. */
  start() {
    mkdirSync(getThemesDir(), { recursive: true });
    this.#migrateLegacyThemes();

    if (!this.#settings.themeConfig().themesSeeded) {
      if (readThemesFrom(getThemesDir()).length === 0) seedBasicTheme();
      this.#settings.setThemeConfig({ themesSeeded: true });
    }
    upgradeBasicTheme();

    this.#reload();
    this.#pruneMissingThemes();
    this.#timer = setInterval(() => this.#poll(), POLL_MS);
    void this.#consentSelected();
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /** Themes as the renderer should see them: a script is withheld until consented. */
  state(): ThemeState {
    const { themeConsent, themePresets } = this.#settings.themeConfig();
    return {
      themes: this.#themes.map((theme) => (isJsConsented(theme, themeConsent) ? theme : withoutScript(theme))),
      selected: this.selected,
      presets: themePresets,
      overrides: this.#paletteLayers(),
    };
  }

  /** Selects a theme, asking for consent to its script first; false when declined. */
  async select(id: string, win?: BrowserWindow): Promise<boolean> {
    this.#refresh();
    const theme = this.#themes.find((entry) => entry.id === id);
    if (theme && !(await this.#consent(theme, win))) return false;

    this.#settings.setThemeConfig({ theme: id });
    this.#onChange();
    return true;
  }

  /** Allows the theme's current script; false when the user declines. */
  async allowScript(id: string, win?: BrowserWindow): Promise<boolean> {
    this.#refresh();
    const theme = this.#themes.find((entry) => entry.id === id);
    if (!theme) return false;
    if (!(await this.#consent(theme, win))) return false;

    this.#onChange();
    return true;
  }

  /** Records the preset picked for a theme (`custom` for their own). */
  setPreset(themeId: string, preset: string) {
    const presets = { ...this.#settings.themeConfig().themePresets, [themeId]: preset };
    this.#settings.setThemeConfig({ themePresets: presets });
    this.#onChange();
  }

  /**
   * Stores one value in a theme's custom palette and selects it, so an edit made
   * while a preset is active continues from that preset.
   */
  setPaletteValue(themeId: string, key: string, value: string) {
    const theme = this.#themes.find((entry) => entry.id === themeId);
    const config = this.#settings.themeConfig();
    const custom = presetPalette(theme?.palette, theme?.presets, config.themePresets[themeId], config.themeOverrides[themeId] ?? {});

    this.#settings.setThemeConfig({
      themeOverrides: { ...config.themeOverrides, [themeId]: { ...custom, [key]: value } },
      themePresets: { ...config.themePresets, [themeId]: CUSTOM_PRESET },
    });
    this.#onChange();
  }

  /** Drops a theme's custom palette and preset pick, restoring its own values. */
  resetPalette(themeId: string) {
    const config = this.#settings.themeConfig();
    const overrides = { ...config.themeOverrides };
    delete overrides[themeId];

    this.#settings.setThemeConfig({
      themeOverrides: overrides,
      themePresets: { ...config.themePresets, [themeId]: "" },
    });
    this.#onChange();
  }

  /** Creates and selects a theme folder from CSS files picked by the user. */
  async import(paths?: string[], win?: BrowserWindow): Promise<string | null> {
    const picked = paths ?? (await pickCssFiles(win));
    const existing = picked.filter((path) => existsSync(path));
    if (existing.length === 0) return null;

    const name = basename(existing[0]!, extname(existing[0]!));
    const { id, folder } = uniqueThemeDir(name);
    writeManifest(folder, { name, css: copyCssFiles(folder, existing), palette: {} });

    this.#settings.setThemeConfig({ theme: id });
    this.#refresh();
    this.#onChange();
    this.#onCatalogChange();
    return id;
  }

  openFolder() {
    const dir = getThemesDir();
    mkdirSync(dir, { recursive: true });
    return shell.openPath(dir);
  }

  async #consent(theme: PearTheme, win?: BrowserWindow): Promise<boolean> {
    if (!theme.js) return true;
    if (isJsConsented(theme, this.#settings.themeConfig().themeConsent)) return true;
    if (!(await ensureJsConsent(theme, this.#t, win))) return false;

    this.#settings.setThemeConfig({
      themeConsent: { ...this.#settings.themeConfig().themeConsent, [theme.id]: theme.js.hash },
    });
    return true;
  }

  /** Asks for consent to the selected theme's script at startup (no window yet). */
  async #consentSelected() {
    await this.#refresh();
    const selected = this.#themes.find((theme) => theme.id === this.selected);
    if (!selected?.js) return;
    if (isJsConsented(selected, this.#settings.themeConfig().themeConsent)) return;
    if (await this.#consent(selected)) this.#onChange();
  }

  /** Re-reads the folders; true when anything in them changed. */
  #reload(): boolean {
    const themes = readThemesFrom(getThemesDir());
    const signature = JSON.stringify(themes);
    if (signature === this.#signature) return false;

    this.#themes = themes;
    this.#signature = signature;
    return true;
  }

  /** Re-reads on demand and, when something changed, drops state for deleted themes. */
  #refresh(): boolean {
    if (!this.#reload()) return false;
    this.#pruneMissingThemes();
    return true;
  }

  #poll() {
    const idsBefore = this.#themes.map((theme) => theme.id).join("\n");
    if (!this.#refresh()) return;
    this.#onChange();
    // Adding or removing a folder changes the native menu's theme list; editing
    // an existing theme's files does not, so the menu is only rebuilt for that.
    if (this.#themes.map((theme) => theme.id).join("\n") !== idsBefore) this.#onCatalogChange();
  }

  /** Turns legacy `options.themes` CSS paths into a single theme folder. */
  #migrateLegacyThemes() {
    const legacy = this.#settings.legacyThemeCss();
    const paths = legacy.filter((path) => existsSync(path));

    if (paths.length > 0) {
      const name = basename(paths[0]!, extname(paths[0]!));
      const { id, folder } = uniqueThemeDir(name);
      writeManifest(folder, { name, css: copyCssFiles(folder, paths), palette: {} });

      if (!this.selected) this.#settings.setThemeConfig({ theme: id });
    }

    this.#settings.clearLegacyThemeCss();
  }

  /**
   * What each theme layers on top of its own palette right now: its selected
   * preset's values, or the user's custom palette. The renderer resolves this
   * with `resolvePalette`, so switching preset needs no reload.
   */
  #paletteLayers(): Record<string, ThemePalette> {
    const { themePresets, themeOverrides } = this.#settings.themeConfig();
    return Object.fromEntries(
      this.#themes.map((theme) => [
        theme.id,
        presetPalette(theme.palette, theme.presets, themePresets[theme.id], themeOverrides[theme.id] ?? {}),
      ]),
    );
  }

  /**
   * Drops config entries for themes whose folder was deleted, so stale overrides,
   * preset picks and JS consent do not accumulate or get inherited by a later
   * theme reusing the same folder name.
   */
  #pruneMissingThemes() {
    const ids = new Set(this.#themes.map((theme) => theme.id));
    const config = this.#settings.themeConfig();
    const keep = <T>(entries: Record<string, T>) =>
      Object.fromEntries(Object.entries(entries).filter(([id]) => ids.has(id))) as Record<string, T>;

    const themeOverrides = keep(config.themeOverrides);
    const themePresets = keep(config.themePresets);
    const themeConsent = keep(config.themeConsent);
    const theme = config.theme && !ids.has(config.theme) ? "" : config.theme;

    const changed =
      Object.keys(themeOverrides).length !== Object.keys(config.themeOverrides).length ||
      Object.keys(themePresets).length !== Object.keys(config.themePresets).length ||
      Object.keys(themeConsent).length !== Object.keys(config.themeConsent).length ||
      theme !== config.theme;
    if (changed) this.#settings.setThemeConfig({ themeOverrides, themePresets, themeConsent, theme });
  }
}
