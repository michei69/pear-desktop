import { readFileSync } from 'node:fs';
import { basename, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';

const __dirname = dirname(fileURLToPath(import.meta.url));

type Mode = 'main' | 'preload' | 'renderer';

/**
 * Builds `virtual:i18n`.
 *
 * Only the languages the app asks for are loaded at runtime. The renderer gets
 * its resources from preload (injected before its script runs), so its bundle
 * carries the metadata but none of the translations.
 */
export const i18nImporter = (mode: Mode) => {
  const srcPath = resolve(__dirname, '..');
  const languages = globSync('src/i18n/resources/*.json')
    .sort()
    .map((path) => {
      const name = basename(path, extname(path));
      const { language } = JSON.parse(
        readFileSync(resolve(srcPath, path), 'utf8'),
      ) as { language?: Record<string, string> };

      return {
        name,
        file: resolve(srcPath, path).replace(/\\/g, '/'),
        meta: { code: name, name, 'local-name': name, ...language },
      };
    });

  let source = `export const languageCodes = ${JSON.stringify(
    languages.map(({ name }) => name),
  )};\n`;
  source += `export const languageMeta = ${JSON.stringify(
    Object.fromEntries(languages.map(({ name, meta }) => [name, meta])),
  )};\n`;

  if (mode === 'renderer') {
    return (
      source +
      `export const loadLanguageResources = async () =>
  globalThis.__PEAR_I18N_RESOURCES__ ?? {};
`
    );
  }

  source += 'const languageLoaders = {\n';
  for (const { name, file } of languages) {
    source += `  ${JSON.stringify(name)}: () => import(${JSON.stringify(file)}),\n`;
  }
  source += '};\n';
  source += `export const loadLanguageResources = async (languages) => {
  const entries = await Promise.all(
    languages.map(async (language) => {
      const load = languageLoaders[language];
      if (!load) return undefined;
      const mod = await load();
      return { [language]: { translation: mod.default } };
    }),
  );
  return Object.assign({}, ...entries);
};\n`;

  return source;
};
