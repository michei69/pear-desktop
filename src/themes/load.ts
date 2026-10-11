import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { join } from 'node:path';

import { parseManifest, type PearTheme, type ThemeJs } from './types';

export const MANIFEST_FILE = 'theme.json';

/** Consent is pinned to this, so it must cover the exact code that runs. */
export const hashThemeJs = (source: string) =>
  createHash('sha256').update(source, 'utf8').digest('hex');

const readIfExists = (path: string): string | null => {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch {
    console.warn(`[themes] could not read ${path}, skipping`);
    return null;
  }
};

/** True when the theme's script may run: no script, or its hash is the consented one. */
export const isJsConsented = (
  theme: Pick<PearTheme, 'id' | 'js'>,
  consent: Record<string, string>,
) => !theme.js || consent[theme.id] === theme.js.hash;

/** Reads one theme folder; `id` is the folder name. */
export const readTheme = (id: string, folder: string): PearTheme | null => {
  const raw = readIfExists(join(folder, MANIFEST_FILE));
  if (raw === null) return null;

  const manifest = parseManifest(raw);
  if (!manifest) {
    console.warn(`[themes] invalid ${MANIFEST_FILE} in ${folder}, skipping`);
    return null;
  }

  const cssFiles =
    manifest.css === undefined
      ? []
      : Array.isArray(manifest.css)
        ? manifest.css
        : [manifest.css];

  let js: ThemeJs | undefined;
  if (manifest.js) {
    const source = readIfExists(join(folder, manifest.js));
    if (source === null) {
      console.warn(
        `[themes] ${id}: js file "${manifest.js}" is missing, theme has no script`,
      );
    } else {
      js = { source, hash: hashThemeJs(source) };
    }
  }

  return {
    id,
    name: manifest.name ?? id,
    description: manifest.description,
    author: manifest.author,
    ...(manifest.palette !== undefined ? { palette: manifest.palette } : {}),
    presets: manifest.presets,
    css: cssFiles
      .map((file) => readIfExists(join(folder, file)))
      .filter((css): css is string => css !== null)
      .join('\n'),
    js,
  };
};

/** Every valid theme folder directly inside `dir`, sorted by folder name. */
export const readThemesFrom = (dir: string): PearTheme[] => {
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => readTheme(entry.name, join(dir, entry.name)))
    .filter((theme): theme is PearTheme => theme !== null);
};
