// The pear "macro compiler" as a Vite plugin.
//
// - Discovers plugins (`plugins/<id>/index.ts`, or `index.tsx`).
// - `virtual:pear/host-plugins` (main process): every plugin, split for the host.
// - `virtual:pear/page-runtime` (preload): the page runtime plus every plugin
//   split for the page, bundled by Rolldown into one self-contained IIFE string
//   that the preload runs in YTM's main world.
// - `virtual:pear/settings-app` (main process): the standalone settings window's
//   script (the settings UI over the bridge), bundled the same way.
// - `virtual:pear/i18n` (main process): the translation files' metadata and one
//   dynamic import per language, so only the ones asked for are loaded.
// - Build-time macros (`with { type: "macro" }`) run in both bundles.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin as RolldownPlugin } from "rolldown";
import Macros from "unplugin-macros/vite";
import RolldownMacros from "unplugin-macros/rolldown";
import type { Plugin } from "vite";
import { splitPlugin, type SplitTarget } from "./split.ts";

export { splitPlugin, type SplitTarget } from "./split.ts";

const HOST_PLUGINS_ID = "virtual:pear/host-plugins";
const I18N_ID = "virtual:pear/i18n";
const PAGE_PLUGINS_ID = "virtual:pear/page-plugins";
const PAGE_RUNTIME_ID = "virtual:pear/page-runtime";
const SETTINGS_APP_ID = "virtual:pear/settings-app";
const VIRTUAL_IDS = new Set([HOST_PLUGINS_ID, I18N_ID, PAGE_RUNTIME_ID, SETTINGS_APP_ID]);
const RESOURCES = new URL("../../../src/i18n/resources/", import.meta.url);
// The id keeps ending in the file's extension (`&lang.ts`, `&lang.tsx`): the macro
// analyzer picks its parser from it and would parse TypeScript as JavaScript otherwise.
const SPLIT_SUFFIX = String.raw`\?pear=(host|page)&lang\.tsx?`;
const SPLIT_QUERY = new RegExp(`${SPLIT_SUFFIX}$`);
// unplugin-macros' default filter rejects ids with a query (our split ids).
const MACRO_OPTIONS = { include: [new RegExp(String.raw`\.[cm]?[jt]sx?(${SPLIT_SUFFIX})?$`)] };
const ENTRY_NAMES = ["index.ts", "index.tsx"];

export interface PearPluginOptions {
  /** Directory containing one folder per plugin. */
  pluginsDir: string;
  /** Entry of the page runtime. Defaults to @pear/page. */
  pageEntry?: string;
  /** Entry of the standalone settings window. Defaults to @pear/ui/standalone. */
  settingsEntry?: string;
  /** Only include these plugin ids (tests). */
  only?: readonly string[];
}

export function discoverPlugins({ pluginsDir, only }: PearPluginOptions): string[] {
  if (!existsSync(pluginsDir)) return [];
  return readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && (!only || only.includes(entry.name)))
    .map((entry) => ENTRY_NAMES.map((name) => resolve(pluginsDir, entry.name, name)).find((file) => existsSync(file)))
    .filter((file) => file !== undefined)
    .sort();
}

const extensionOf = (file: string) => (file.endsWith(".tsx") ? "tsx" : "ts");

function registryModule(files: readonly string[], target: SplitTarget) {
  const splitId = (file: string) => `${file}?pear=${target}&lang.${extensionOf(file)}`;
  const imports = files.map((file, i) => `import p${i} from ${JSON.stringify(splitId(file))};`);
  return `${imports.join("\n")}\nexport default [${files.map((_, i) => `p${i}`).join(", ")}];\n`;
}

function splitTransform(code: string, id: string) {
  const match = SPLIT_QUERY.exec(id);
  if (!match) return;
  const file = id.replace(SPLIT_QUERY, "");
  return { code: splitPlugin(code, file, match[1] as SplitTarget), map: null };
}

/**
 * `virtual:pear/i18n`: the language list and metadata (every file), with each
 * file behind its own dynamic import, so a bundle carries only the languages it
 * asks `loadLanguageResources` for.
 */
export function i18nModule(watch: (file: string) => void) {
  const files = new Map(
    readdirSync(RESOURCES)
      .filter((name) => name.endsWith(".json"))
      .map((name) => [name.slice(0, -5), name] as const),
  );
  const languages = [...files.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, name]) => {
      const file = fileURLToPath(new URL(name, RESOURCES)).replace(/\\/g, "/");
      // The file's own `language` block carries the display names; fall back to the code.
      const resource = JSON.parse(readFileSync(file, "utf8")) as { language?: Record<string, string> };
      watch(file);
      return { code, file, meta: { code, name: code, "local-name": code, ...(resource.language ?? {}) } };
    });
  return [
    `export const languageCodes = ${JSON.stringify(languages.map(({ code }) => code))};`,
    `export const languageMeta = ${JSON.stringify(Object.fromEntries(languages.map(({ code, meta }) => [code, meta])))};`,
    "const languageLoaders = {",
    ...languages.map(({ code, file }) => `  ${JSON.stringify(code)}: () => import(${JSON.stringify(file)}),`),
    "};",
    "/** The resources of these languages, by code; unknown codes are skipped. */",
    "export async function loadLanguageResources(codes) {",
    "  const entries = await Promise.all(",
    "    codes.map(async (code) => {",
    "      const load = languageLoaders[code];",
    "      return load ? [code, (await load()).default] : undefined;",
    "    }),",
    "  );",
    "  return Object.fromEntries(entries.filter(Boolean));",
    "}",
    "",
  ].join("\n");
}

export default function pear(options: PearPluginOptions): Plugin[] {
  // The virtual modules that are a bundle of their own, and its entry.
  const bundleEntries: Record<string, string> = {
    [`\0${PAGE_RUNTIME_ID}`]: options.pageEntry ?? fileURLToPath(import.meta.resolve("@pear/page")),
    [`\0${SETTINGS_APP_ID}`]: options.settingsEntry ?? fileURLToPath(import.meta.resolve("@pear/ui/standalone")),
  };

  const plugin: Plugin = {
    name: "pear",
    enforce: "pre",
    resolveId(id) {
      if (VIRTUAL_IDS.has(id)) return `\0${id}`;
    },
    load(id) {
      if (id === `\0${HOST_PLUGINS_ID}`) {
        const files = discoverPlugins(options);
        this.addWatchFile(options.pluginsDir);
        return registryModule(files, "host");
      }
      if (id === `\0${I18N_ID}`) return i18nModule((file) => this.addWatchFile(file));
      const entry = bundleEntries[id];
      if (entry) {
        return bundlePage(entry, options).then(({ code, watchFiles }) => {
          for (const file of watchFiles) this.addWatchFile(file);
          return `export default ${JSON.stringify(code)};`;
        });
      }
    },
    transform(code, id) {
      return splitTransform(code, id);
    },
  };

  return [plugin, Macros(MACRO_OPTIONS) as Plugin];
}

function pagePluginsPlugin(options: PearPluginOptions): RolldownPlugin {
  return {
    name: "pear:page-plugins",
    resolveId(id) {
      if (id === PAGE_PLUGINS_ID) return `\0${id}`;
    },
    load(id) {
      if (id === `\0${PAGE_PLUGINS_ID}`) return registryModule(discoverPlugins(options), "page");
      if (SPLIT_QUERY.test(id)) {
        const file = id.replace(SPLIT_QUERY, "");
        return { code: readFileSync(file, "utf8"), moduleType: extensionOf(file) };
      }
    },
    transform(code, id) {
      return splitTransform(code, id);
    },
  };
}

/** Bundles the page runtime with every plugin's page part (exported for tests). */
export async function bundlePage(entry: string, options: PearPluginOptions) {
  const result = await build({
    input: entry,
    write: false,
    platform: "browser",
    plugins: [pagePluginsPlugin(options), RolldownMacros(MACRO_OPTIONS)],
    // JSX: tsconfig.base.json's Preact, or the DOM runtime in files whose pragma asks for @pear/sdk.
    output: { format: "iife", minify: process.env.NODE_ENV === "production" },
  });
  const chunk = result.output.find((o) => o.type === "chunk" && o.isEntry);
  if (!chunk || chunk.type !== "chunk") {
    throw new Error(`[pear] page runtime bundle produced no entry chunk (${entry})`);
  }
  const watchFiles = Object.keys(chunk.modules)
    .filter((id) => !id.startsWith("\0"))
    .map((id) => id.replace(SPLIT_QUERY, ""));
  return { code: chunk.code, watchFiles: [...watchFiles, options.pluginsDir] };
}
