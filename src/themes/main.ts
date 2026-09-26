import fs from 'node:fs';
import { basename, extname, join } from 'node:path';

import { app, dialog, shell, type BrowserWindow } from 'electron';

import {
  get as getConfig,
  getThemeConsent,
  getThemeOverrides,
  set as setConfig,
  setThemeConsent,
  setThemeOverrides,
} from '@/config';
import { store } from '@/config/store';
import { t } from '@/i18n';

import basicCss from './basic.css?inline';
import { isJsConsented, MANIFEST_FILE, readThemesFrom } from './load';
import { parseManifest, type PearTheme, type ThemeManifest } from './types';

export { MANIFEST_FILE } from './load';

/**
 * Palette for the theme seeded on first run. Kept identical to the old
 * built-in default so an install with no authored themes is unchanged.
 */
const DEFAULT_PALETTE = {
  accent: '#ff0000',
  background: '#030303',
  surface: '#1f1f1f',
  text: '#ffffff',
};

const BASIC_THEME_ID = 'basic';
const BASIC_CSS_FILE = 'style.css';

export const getThemesDir = () => join(app.getPath('userData'), 'themes');

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'theme';

export const loadThemes = (): PearTheme[] => readThemesFrom(getThemesDir());

/**
 * Themes as the renderer should see them. A theme's script is withheld unless
 * the user consented to its current hash, so unvetted code never crosses to
 * the renderer in the first place.
 */
export const themesForRenderer = (): PearTheme[] => {
  const consent = getThemeConsent();
  return loadThemes().map((theme) =>
    isJsConsented(theme, consent) ? theme : { ...theme, js: undefined },
  );
};

/**
 * Ensures the user has consented to `theme`'s script, prompting if the script
 * is new or its contents changed since they last agreed.
 *
 * Returns false if the user declined, in which case the caller must not switch
 * to the theme.
 */
export const ensureJsConsent = async (
  theme: PearTheme,
  win?: BrowserWindow,
): Promise<boolean> => {
  if (!theme.js) return true;

  const consent = getThemeConsent();
  if (isJsConsented(theme, consent)) return true;

  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    // Refuse rather than default to running unvetted code.
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: t('main.themes.consent.title'),
    message: t('main.themes.consent.message', { theme: theme.name }),
    detail: t('main.themes.consent.detail'),
    buttons: [t('main.themes.consent.allow'), t('main.themes.consent.cancel')],
  };

  // A parent keeps the dialog attached to the window when we have one; at
  // startup (before the window exists) it is shown on its own.
  const { response } = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  if (response !== 0) return false;

  setThemeConsent({ ...consent, [theme.id]: theme.js.hash });
  return true;
};

const writeManifest = (
  folder: string,
  manifest: Required<Pick<ThemeManifest, 'name'>> & ThemeManifest,
) => {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    join(folder, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
};

const copyCssFiles = (folder: string, paths: string[]): string[] => {
  fs.mkdirSync(folder, { recursive: true });
  return paths.map((path, index) => {
    const fileName =
      paths.length === 1 ? 'style.css' : `${index + 1}-${basename(path)}`;
    fs.copyFileSync(path, join(folder, fileName));
    return fileName;
  });
};

const uniqueThemeDir = (name: string): { id: string; folder: string } => {
  const dir = getThemesDir();
  const base = slugify(name);
  let id = base;
  for (let n = 2; fs.existsSync(join(dir, id)); n++) {
    id = `${base}-${n}`;
  }
  return { id, folder: join(dir, id) };
};

/** Writes the Basic theme's stylesheet and points its manifest at it. */
const writeBasicTheme = (
  folder: string,
  manifest: Omit<ThemeManifest, 'css'> & { name: string },
) => {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(join(folder, BASIC_CSS_FILE), basicCss);
  writeManifest(folder, { ...manifest, css: BASIC_CSS_FILE });
};

const seedBasicTheme = () => {
  const { folder } = uniqueThemeDir(BASIC_THEME_ID);
  if (fs.existsSync(join(folder, MANIFEST_FILE))) return;

  writeBasicTheme(folder, {
    name: 'Basic',
    description:
      'Recolours YouTube Music from a four-colour palette you can edit.',
    author: 'pear-desktop',
    palette: DEFAULT_PALETTE,
  });
};

/**
 * Installs seeded before the recolour moved into the theme itself have a
 * palette but no CSS, so they would stop recolouring. Give them the
 * stylesheet, keeping the rest of their manifest as it is.
 *
 * A Basic theme the user gave its own CSS is left alone, and a deleted one is
 * not re-created.
 */
const upgradeBasicTheme = () => {
  const folder = join(getThemesDir(), BASIC_THEME_ID);
  const manifestPath = join(folder, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return;

  const manifest = parseManifest(fs.readFileSync(manifestPath, 'utf8'));
  const declared = manifest?.css;
  // The old seed wrote `"css": []`, so an empty list means "no CSS yet".
  const hasOwnCss = Array.isArray(declared)
    ? declared.length > 0
    : Boolean(declared);
  if (!manifest || hasOwnCss) return;

  writeBasicTheme(folder, { ...manifest, name: manifest.name ?? 'Basic' });
};

/** Turns legacy `options.themes` CSS paths into a single theme folder. */
const migrateLegacyThemes = () => {
  const legacy = store.get('options.themes');
  if (Array.isArray(legacy) && legacy.length > 0) {
    const paths = legacy.filter(
      (path): path is string => typeof path === 'string' && fs.existsSync(path),
    );

    if (paths.length > 0) {
      const name = basename(paths[0], extname(paths[0]));
      const { id, folder } = uniqueThemeDir(name);
      writeManifest(folder, {
        name,
        css: copyCssFiles(folder, paths),
        palette: {},
      });

      if (!getConfig('options.theme')) setConfig('options.theme', id);
    }
  }

  store.delete('options.themes');
};

export const setupThemes = async () => {
  fs.mkdirSync(getThemesDir(), { recursive: true });
  migrateLegacyThemes();

  if (!getConfig('options.themesSeeded')) {
    if (loadThemes().length === 0) seedBasicTheme();
    setConfig('options.themesSeeded', true);
  }
  // An install from before the recolour lived in a theme has a Basic theme
  // with a palette but no CSS.
  upgradeBasicTheme();

  pruneMissingThemes();

  // The theme is already selected here, so this only prompts when its script
  // is new or has changed since the user last agreed to run it.
  const selected = loadThemes().find(
    (theme) => theme.id === getConfig('options.theme'),
  );
  if (selected) await ensureJsConsent(selected);
};

/** Creates a theme folder from CSS file(s) picked by the user. */
export const createThemeFromCssFiles = (paths: string[]): string | null => {
  const existing = paths.filter((path) => fs.existsSync(path));
  if (existing.length === 0) return null;

  const name = basename(existing[0], extname(existing[0]));
  const { id, folder } = uniqueThemeDir(name);
  writeManifest(folder, {
    name,
    css: copyCssFiles(folder, existing),
    palette: {},
  });

  return id;
};

export const openThemesFolder = () => {
  const dir = getThemesDir();
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
};

/**
 * Drops config entries for themes that no longer exist. Themes are removed by
 * deleting their folder, so this is what keeps stale palette overrides and JS
 * consent from accumulating — and from being inherited by a later theme that
 * happens to reuse the same folder name.
 */
const pruneMissingThemes = () => {
  const ids = loadThemes().map((theme) => theme.id);

  const keep = <T>(entries: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(entries).filter(([id]) => ids.includes(id)),
    );

  const overrides = getThemeOverrides();
  const keptOverrides = keep(overrides);
  if (Object.keys(keptOverrides).length !== Object.keys(overrides).length) {
    setThemeOverrides(keptOverrides);
  }

  const consent = getThemeConsent();
  const keptConsent = keep(consent);
  if (Object.keys(keptConsent).length !== Object.keys(consent).length) {
    setThemeConsent(keptConsent);
  }

  const selected = getConfig('options.theme');
  if (selected && !ids.includes(selected)) setConfig('options.theme', '');
};
