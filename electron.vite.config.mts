import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import builtinModules from 'builtin-modules';
import {
  defineConfig,
  type MainViteConfig,
  type PreloadViteConfig,
  type RendererViteConfig,
} from 'electron-vite';
import { withFilter } from 'vite';
import Inspect from 'vite-plugin-inspect';
import viteResolve from 'vite-plugin-resolve';
import solidPlugin from 'vite-plugin-solid';

import { i18nImporter } from './vite-plugins/i18n-importer.mjs';
import { pluginVirtualModuleGenerator } from './vite-plugins/plugin-importer.mjs';
import pluginLoader from './vite-plugins/plugin-loader.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const resolveAlias = {
  '@': resolve(__dirname, './src'),
  '@assets': resolve(__dirname, './assets'),
};

// Baked into the main bundle for the About window (src/app-info.ts). CI sets both;
// locally the channel stays unbaked (dev) and the commit comes from the checkout.
const gitCommit = () => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
};
const buildInfo = {
  __PEAR_CHANNEL__: JSON.stringify(process.env.PEAR_CHANNEL?.trim() || 'dev'),
  __PEAR_COMMIT__: JSON.stringify(
    (process.env.PEAR_COMMIT?.trim() || gitCommit()).slice(0, 7),
  ),
};

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';

  // node-smtc is a Windows-only optional dependency, so it is not installed
  // anywhere else. Left to the bundler, its dynamic import in src/index.ts is
  // resolved at build time and fails the whole build on macOS/Linux; keeping it
  // external leaves the import for the `is.windows()` guard to reach (or not).
  const mainAndPreloadExcludes = [
    'electron',
    'custom-electron-prompt',
    'node-smtc',
    ...builtinModules,
  ];
  const mainConfig: MainViteConfig = {
    plugins: [
      pluginLoader('backend'),
      viteResolve({
        'virtual:i18n': i18nImporter('main'),
        'virtual:plugins': pluginVirtualModuleGenerator('main'),
      }),
    ],
    publicDir: 'assets',
    define: {
      __dirname: 'import.meta.dirname',
      __filename: 'import.meta.filename',
      ...buildInfo,
    },
    json: {
      namedExports: false,
      stringify: true,
    },
    build: {
      // No `build.lib` here: electron-vite's `?modulePath` sub-build (the
      // downloader's ffmpeg worker) inherits this config, and a lib entry with
      // `formats` makes it emit an output array, which the plugin's
      // `bundles.output` destructure cannot consume. `rolldownOptions.input`
      // below drives the same entry, and the preset derives the `es` format
      // from the package type.
      outDir: 'dist/main',
      rolldownOptions: {
        external: mainAndPreloadExcludes,
        input: './src/index.ts',
        output: {
          comments: {
            jsdoc: true,
            annotation: false,
            legal: true,
          },
        },
      },
      minify: !isDev,
      cssMinify: !isDev,
      sourcemap: isDev ? 'inline' : undefined,
      externalizeDeps: false,
    },
    resolve: {
      alias: resolveAlias,
    },
  };

  const preloadConfig: PreloadViteConfig = {
    plugins: [
      pluginLoader('preload'),
      viteResolve({
        'virtual:i18n': i18nImporter('preload'),
        'virtual:plugins': pluginVirtualModuleGenerator('preload'),
      }),
    ],
    build: {
      lib: {
        entry: 'src/preload.ts',
        formats: ['cjs'],
      },
      outDir: 'dist/preload',
      commonjsOptions: {
        ignoreDynamicRequires: true,
      },
      rolldownOptions: {
        external: mainAndPreloadExcludes,
        input: './src/preload.ts',
      },
      minify: !isDev,
      cssMinify: !isDev,
      sourcemap: isDev ? 'inline' : undefined,
      externalizeDeps: false,
    },
    resolve: {
      alias: resolveAlias,
    },
  };

  const rendererExcludes = ['electron', ...builtinModules];
  const rendererConfig: RendererViteConfig = {
    plugins: [
      pluginLoader('renderer'),
      viteResolve({
        'virtual:i18n': i18nImporter('renderer'),
        'virtual:plugins': pluginVirtualModuleGenerator('renderer'),
      }),
      withFilter(solidPlugin(), {
        load: { id: [/\.(tsx|jsx)$/, '/@solid-refresh'] },
      }),
    ],
    root: './src/',
    build: {
      lib: {
        entry: 'src/index.html',
        formats: ['iife'],
        name: 'renderer',
      },
      outDir: 'dist/renderer',
      rolldownOptions: {
        external: rendererExcludes,
        input: './src/index.html',
        // The preload injects this file as one script into the page world, so
        // dynamic imports must stay in the file (`codeSplitting: false` is the
        // non-deprecated `inlineDynamicImports`). They are still deferred: the
        // imported module body runs only when `import()` is called.
        output: {
          codeSplitting: false,
        },
      },
      minify: !isDev,
      cssMinify: !isDev,
      sourcemap: isDev ? 'inline' : undefined,
    },
    resolve: {
      alias: resolveAlias,
    },
    server: {
      cors: {
        origin: 'https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com',
      },
    },
  };

  if (isDev) {
    mainConfig.plugins?.push(
      Inspect({
        build: true,
        outputDir: join(__dirname, '.vite-inspect/backend'),
      }),
    );
    preloadConfig.plugins?.push(
      Inspect({
        build: true,
        outputDir: join(__dirname, '.vite-inspect/preload'),
      }),
    );
    rendererConfig.plugins?.push(
      Inspect({
        build: true,
        outputDir: join(__dirname, '.vite-inspect/renderer'),
      }),
    );
  }

  return {
    main: mainConfig,
    preload: preloadConfig,
    renderer: rendererConfig,
  };
});
