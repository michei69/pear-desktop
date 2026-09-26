/**
 * An external theme is a folder under `<userData>/themes`:
 *
 *   my-theme/
 *     theme.json    manifest (name, palette, css files)
 *     style.css     optional styles, named by the manifest
 *     theme.js      optional script, named by the manifest
 *
 * The folder name is the theme id. Palette entries are emitted verbatim as
 * `--pear-theme-<key>` CSS custom properties, so a value can be any CSS value
 * (colour, font, length, ...)
 */

export type ThemePalette = Record<string, string>;

export type ThemeManifest = {
  name?: string;
  description?: string;
  author?: string;
  palette?: ThemePalette;
  /** CSS file(s) relative to the theme folder, applied in order. */
  css?: string | string[];
  /**
   * JS file relative to the theme folder, run when the theme is applied.
   * Its hash is what the user consents to, so this must be declared rather
   * than auto-discovered.
   */
  js?: string;
};

export type PearTheme = {
  id: string;
  name: string;
  description?: string;
  author?: string;
  palette: ThemePalette;
  /** Concatenated contents of the manifest's css files. */
  css: string;
  js?: ThemeJs;
};

/** A theme's script, with the hash consent is pinned to. */
export type ThemeJs = {
  source: string;
  hash: string;
};

/** The API handed to a theme's `mount`. */
export type ThemeContext = {
  id: string;
  palette: ThemePalette;
  applyPalette: (palette: ThemePalette) => void;
};

/**
 * A theme's script may `module.exports` (or `export default`, transpiled by
 * the reader) an object with these hooks. `mount` may return a cleanup
 * function, which runs before `unmount` when the theme is replaced.
 */
export type ThemeHooks = {
  mount?: (context: ThemeContext) => (() => void) | void;
  unmount?: () => void;
};

export const isPalette = (value: unknown): value is ThemePalette =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((entry) => typeof entry === 'string');

export const isCssList = (value: unknown): value is string | string[] =>
  typeof value === 'string' ||
  (Array.isArray(value) && value.every((entry) => typeof entry === 'string'));

export const parseManifest = (raw: string): ThemeManifest | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const manifest = parsed as ThemeManifest;
  if (manifest.palette !== undefined && !isPalette(manifest.palette)) {
    return null;
  }

  if (manifest.css !== undefined && !isCssList(manifest.css)) {
    return null;
  }

  if (manifest.js !== undefined && typeof manifest.js !== 'string') {
    return null;
  }

  return manifest;
};

/** User overrides win over the theme's own palette values. */
export const resolvePalette = (
  palette: ThemePalette,
  overrides: ThemePalette,
): ThemePalette => ({ ...palette, ...overrides });

/**
 * Normalizes the `peard:get-themes` response. A config stored before the
 * theme keys existed omits them, so nothing may be assumed present here.
 */
export const normalizeThemeState = (
  payload: Partial<ThemeState>,
): ThemeState => ({
  themes: payload.themes ?? [],
  selected: payload.selected ?? '',
  overrides: payload.overrides ?? {},
});

export type ThemeState = {
  themes: PearTheme[];
  /** Selected theme id, or '' for no theme. */
  selected: string;
  /** Per-theme palette overrides, keyed by theme id then palette key. */
  overrides: Record<string, Record<string, string>>;
};

/**
 * Emits the palette as `--pear-theme-<key>` custom properties. Values are
 * passed through verbatim, so any CSS value works.
 */
export const paletteToCss = (palette: ThemePalette) =>
  `:root {\n${Object.entries(palette)
    .map(([key, value]) => `  --pear-theme-${key}: ${value};`)
    .join('\n')}\n}`;
