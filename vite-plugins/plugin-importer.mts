import { existsSync } from 'node:fs';
import { basename, resolve, extname, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';
import {
  Node,
  Project,
  type ObjectLiteralExpression,
  type SourceFile,
} from 'ts-morph';

import { Platform } from '../src/types/plugins';

const kebabToCamel = (text: string) =>
  text.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase());

const __dirname = dirname(fileURLToPath(import.meta.url));
const globalProject = new Project({
  tsConfigFilePath: resolve(__dirname, '..', 'tsconfig.json'),
  skipAddingFilesFromTsConfig: true,
  skipLoadingLibFiles: true,
  skipFileDependencyResolution: true,
});

/**
 * The renderer decides which plugins to import before it knows anything about
 * them. These static facts let it skip the module graph of disabled plugins;
 * `null` means "could not read it statically", in which case the loader falls
 * back to importing the module and reading the real definition.
 */
type RendererPluginMeta = {
  hasRenderer: boolean | null;
  essential: boolean | null;
  enabled: boolean | null;
  platform: number | null;
};

const sourceFileCache = new Map<string, SourceFile | undefined>();
const moduleExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

const getSourceFile = (path: string) => {
  if (!sourceFileCache.has(path)) {
    sourceFileCache.set(path, globalProject.addSourceFileAtPathIfExists(path));
  }
  return sourceFileCache.get(path);
};

const resolveModulePath = (from: string, specifier: string) => {
  let base: string;
  if (specifier.startsWith('@/')) {
    base = resolve(__dirname, '..', 'src', specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = resolve(dirname(from), specifier);
  } else {
    return undefined;
  }

  return [
    base,
    ...moduleExtensions.map((extension) => base + extension),
    ...moduleExtensions.map((extension) => join(base, `index${extension}`)),
  ].find(existsSync);
};

const unwrapExpression = (node: Node | undefined) => {
  let current = node;
  while (
    current &&
    (Node.isParenthesizedExpression(current) ||
      Node.isAsExpression(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isNonNullExpression(current))
  ) {
    current = current.getExpression();
  }
  return current;
};

/** Follows identifiers to the object literal they were declared with. */
const getObjectExpression = (
  node: Node | undefined,
  visited = new Set<string>(),
): ObjectLiteralExpression | undefined => {
  const expression = unwrapExpression(node);
  if (!expression) return undefined;

  if (Node.isObjectLiteralExpression(expression)) return expression;

  if (
    Node.isCallExpression(expression) &&
    expression.getExpression().getText() === 'createPlugin'
  ) {
    return getObjectExpression(expression.getArguments()[0], visited);
  }

  if (!Node.isIdentifier(expression)) return undefined;

  const sourceFile = expression.getSourceFile();
  const name = expression.getText();
  const key = `${sourceFile.getFilePath()}#${name}`;
  if (visited.has(key)) return undefined;
  visited.add(key);

  const local = sourceFile.getVariableDeclaration(name)?.getInitializer();
  if (local) return getObjectExpression(local, visited);

  for (const declaration of sourceFile.getImportDeclarations()) {
    const namedImport = declaration
      .getNamedImports()
      .find(
        (entry) =>
          (entry.getAliasNode()?.getText() ?? entry.getName()) === name,
      );
    const defaultImport = declaration.getDefaultImport()?.getText() === name;
    if (!namedImport && !defaultImport) continue;

    const modulePath = resolveModulePath(
      sourceFile.getFilePath(),
      declaration.getModuleSpecifierValue(),
    );
    if (!modulePath) continue;

    const importedFile = getSourceFile(modulePath);
    const importedName = namedImport?.getName() ?? 'default';
    const imported = importedFile
      ?.getVariableDeclaration(importedName)
      ?.getInitializer();
    if (imported) return getObjectExpression(imported, visited);
  }

  return undefined;
};

const getPluginDefinition = (sourceFile: SourceFile) => {
  const exportAssignment = sourceFile.getExportAssignment(
    (assignment) => !assignment.isExportEquals(),
  );
  if (exportAssignment) {
    return getObjectExpression(exportAssignment.getExpression());
  }

  return getObjectExpression(
    sourceFile.getExportedDeclarations().get('default')?.[0],
  );
};

const getBooleanProperty = (
  object: ObjectLiteralExpression,
  name: string,
): boolean | null => {
  const property = object.getProperty(name);
  if (!property) return null;
  if (!Node.isPropertyAssignment(property)) return null;

  const initializer = unwrapExpression(property.getInitializer());
  if (initializer?.getText() === 'true') return true;
  if (initializer?.getText() === 'false') return false;
  return null;
};

const getConfigEnabled = (object: ObjectLiteralExpression): boolean | null => {
  const property = object.getProperty('config');
  if (!property) return false;
  if (!Node.isPropertyAssignment(property)) return null;

  const config = getObjectExpression(property.getInitializer());
  if (!config) return null;
  if (!config.getProperty('enabled')) return false;

  return getBooleanProperty(config, 'enabled');
};

const getPlatformValue = (node: Node | undefined): number | null => {
  const expression = unwrapExpression(node);
  if (!expression) return null;

  if (Node.isNumericLiteral(expression)) {
    return Number(expression.getLiteralValue());
  }
  if (
    Node.isPropertyAccessExpression(expression) &&
    expression.getExpression().getText() === 'Platform'
  ) {
    const value = Platform[expression.getName() as keyof typeof Platform];
    return typeof value === 'number' ? value : null;
  }
  if (Node.isBinaryExpression(expression)) {
    const left = getPlatformValue(expression.getLeft());
    const right = getPlatformValue(expression.getRight());
    return left === null || right === null ? null : left | right;
  }

  return null;
};

const getPlatform = (object: ObjectLiteralExpression): number | null => {
  const property = object.getProperty('platform');
  if (!property || !Node.isPropertyAssignment(property)) return null;

  return getPlatformValue(property.getInitializer());
};

const getRendererPluginMeta = (path: string): RendererPluginMeta => {
  const sourceFile = getSourceFile(path);
  const definition = sourceFile ? getPluginDefinition(sourceFile) : undefined;
  if (!definition) {
    return {
      hasRenderer: null,
      essential: null,
      enabled: null,
      platform: null,
    };
  }

  return {
    hasRenderer: definition.getProperty('renderer') !== undefined,
    essential: definition.getProperty('essential')
      ? getBooleanProperty(definition, 'essential')
      : false,
    enabled: getConfigEnabled(definition),
    platform: getPlatform(definition),
  };
};

export const pluginVirtualModuleGenerator = (
  mode: 'main' | 'preload' | 'renderer',
) => {
  const srcPath = resolve(__dirname, '..', 'src');
  const plugins = globSync([
    'src/plugins/*/index.{js,ts,jsx,tsx}',
    'src/plugins/*.{js,ts,jsx,tsx}',
    '!src/plugins/utils/**/*',
    '!src/plugins/utils/*',
  ]).map((path) => {
    let name = basename(path);
    if (
      name === 'index.ts' ||
      name === 'index.js' ||
      name === 'index.jsx' ||
      name === 'index.tsx'
    ) {
      name = basename(resolve(path, '..'));
    }

    name = name.replace(extname(name), '');

    return { name, path };
  });

  const src = globalProject.createSourceFile(
    'vm:pluginIndexes',
    (writer) => {
      for (const { name, path } of plugins) {
        const absolutePath = resolve(srcPath, '..', path).replace(/\\/g, '/');
        if (mode === 'main') {
          // Dynamic imports stay deferred even though `inlineDynamicImports`
          // folds them into the single main file: the module body only runs
          // when the loader actually asks for that plugin.
          writer.writeLine(
            `const ${kebabToCamel(name)}PluginImport = () => import('${absolutePath}');`,
          );
          writer.writeLine(
            `const ${kebabToCamel(name)}Plugin = async () => (await ${kebabToCamel(name)}PluginImport()).default;`,
          );
          writer.writeLine(
            `const ${kebabToCamel(name)}PluginStub = async () => (await ${kebabToCamel(name)}PluginImport()).pluginStub;`,
          );
        } else {
          // Renderer and preload: static imports. The renderer cannot use the
          // deferred form above — wrapping every plugin module in an
          // `__esmMin` lazy initializer makes rolldown drop shared
          // declarations (solid-js's `createContext` et al. survive as bare
          // globals) and the injected IIFE throws on load. Preload never
          // supported dynamic import anyway.
          writer.writeLine(
            `import ${kebabToCamel(name)}PluginImport, { pluginStub as ${kebabToCamel(name)}PluginStubImport } from "${absolutePath}";`,
          );
          writer.writeLine(
            `const ${kebabToCamel(name)}Plugin = () => Promise.resolve(${kebabToCamel(name)}PluginImport);`,
          );
          writer.writeLine(
            `const ${kebabToCamel(name)}PluginStub = () => Promise.resolve(${kebabToCamel(name)}PluginStubImport);`,
          );
        }
      }

      writer.blankLine();
      if (mode === 'main' || mode === 'preload') {
        writer.writeLine("import is from 'electron-is';");
        writer.writeLine('globalThis.electronIs = is;');
      }
      writer.write(
        `${mode === 'renderer' ? 'export ' : ''}${supportsPlatform.toString()}`,
      );
      writer.blankLine();

      if (mode === 'renderer') {
        // Lets the loader decide what to import without importing anything:
        // disabled plugins never evaluate their module graph.
        writer.writeLine('export const rendererPluginMeta = {');
        for (const { name, path } of plugins) {
          const absolutePath = resolve(srcPath, '..', path);
          const meta = getRendererPluginMeta(absolutePath);
          writer.writeLine(
            `  ${JSON.stringify(name)}: ${JSON.stringify(meta)},`,
          );
        }
        writer.writeLine('};');
        writer.blankLine();

        writer.writeLine('const rendererPluginLoaders = {');
        for (const { name } of plugins) {
          writer.writeLine(
            `  ${JSON.stringify(name)}: ${kebabToCamel(name)}Plugin,`,
          );
        }
        writer.writeLine('};');
        writer.blankLine();

        writer.writeLine('export const rendererPlugin = async (id) => {');
        writer.writeLine('  const load = rendererPluginLoaders[id];');
        writer.writeLine('  if (!load) return undefined;');
        writer.writeLine('  const plugin = await load();');
        writer.writeLine(
          '  return plugin && plugin.renderer && supportsPlatform(plugin) ? plugin : undefined;',
        );
        writer.writeLine('};');
        writer.blankLine();
      }

      writer.writeLine(`let ${mode}PluginsCache = null;`);
      writer.writeLine(`export const ${mode}Plugins = async () => {`);
      writer.writeLine(
        `  if (${mode}PluginsCache) return await ${mode}PluginsCache;`,
      );
      writer.writeLine(
        '  const { promise, resolve } = Promise.withResolvers();',
      );
      writer.writeLine('  ' + `${mode}PluginsCache = promise;`);
      writer.writeLine('  const pluginEntries = await Promise.all([');
      for (const { name } of plugins) {
        const checkMode = mode === 'main' ? 'backend' : mode;
        // HACK: avoids importing renderer plugins in main
        writer.writeLine(
          `    ${kebabToCamel(name)}Plugin().then((plg) => plg['${checkMode}'] ? ["${name}", plg] : null),`,
        );
      }
      writer.writeLine('  ]);');
      writer.writeLine(
        '  resolve(pluginEntries.filter((entry) => entry && supportsPlatform(entry[1])).reduce((acc, [name, plg]) => { acc[name] = plg; return acc; }, {}));',
      );
      writer.writeLine(`  return await ${mode}PluginsCache;`);
      writer.writeLine('};');
      writer.blankLine();

      // All plugins export (stub only) // Omit<Plugin, 'backend' | 'preload' | 'renderer'>
      writer.writeLine('let allPluginsCache = null;');
      writer.writeLine('export const allPlugins = async () => {');
      writer.writeLine('  if (allPluginsCache) return await allPluginsCache;');
      writer.writeLine(
        '  const { promise, resolve } = Promise.withResolvers();',
      );
      writer.writeLine('  allPluginsCache = promise;');
      writer.writeLine('  const stubEntries = await Promise.all([');
      for (const { name } of plugins) {
        writer.writeLine(
          `    ${kebabToCamel(name)}PluginStub().then((stub) => ["${name}", stub]),`,
        );
      }
      writer.writeLine('  ]);');
      writer.writeLine(
        '  resolve(stubEntries.filter(entry => entry && supportsPlatform(entry[1])).reduce((acc, [name, plg]) => { acc[name] = plg; return acc; }, {}));',
      );
      writer.writeLine('  return await promise;');
      writer.writeLine('};');
      writer.blankLine();
    },
    { overwrite: true },
  );

  return src.getText();
};

function supportsPlatform({ platform }: { platform: string }) {
  if (typeof platform !== 'number') return true;

  const is = (
    globalThis as typeof globalThis & {
      electronIs: typeof import('electron-is');
    }
  ).electronIs;

  if (is.windows()) return (platform & Platform.Windows) !== 0;
  if (is.macOS()) return (platform & Platform.macOS) !== 0;
  if (is.linux()) return (platform & Platform.Linux) !== 0;
  if (is.freebsd()) return (platform & Platform.Freebsd) !== 0;

  // unknown platform
  return false;
}
