import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import pear from "@pear/vite-plugin";
import { defineConfig } from "electron-vite";

/** The commit an unbaked build came from; empty outside a git checkout. */
function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

// Baked into the main bundle for the About window and the update checks. CI sets
// both; local builds get the dev channel and the current commit.
const buildInfo = {
  __PEAR_CHANNEL__: JSON.stringify(process.env.PEAR_CHANNEL?.trim() || "dev"),
  __PEAR_COMMIT__: JSON.stringify((process.env.PEAR_COMMIT?.trim() || gitCommit()).slice(0, 7)),
};

const pearOptions = {
  pluginsDir: resolve(import.meta.dirname, "../../plugins"),
  ...(process.env.PEAR_ONLY_PLUGINS ? { only: process.env.PEAR_ONLY_PLUGINS.split(",") } : {}),
};

export default defineConfig(({ mode }) => {
  // Packaged builds ship minified code without source maps; development keeps
  // inline maps so main-process stack traces point at the sources (the dev
  // scripts also pass NODE_OPTIONS=--enable-source-maps).
  const isDev = mode === "development";

  return {
    main: {
      plugins: [pear(pearOptions)],
      define: buildInfo,
      // Translation files are dynamic imports; only the `default` export is used.
      json: { namedExports: false },
      build: {
        minify: isDev ? false : "oxc",
        sourcemap: isDev ? "inline" : false,
        rolldownOptions: {
          // Windows-only optional native module; imported dynamically at runtime.
          external: ["@michei69/node-smtc"],
          // Vite's ES-lib default leaves codegen (whitespace/comments) on even when
          // minifying; packaged main bundles are fully minified here.
          output: { minify: true },
        },
      },
    },
    preload: {
      plugins: [pear(pearOptions)],
      build: {
        minify: !isDev,
        sourcemap: isDev ? "inline" : false,
        rollupOptions: {
          // Sandboxed preloads must be CommonJS.
          output: { format: "cjs", entryFileNames: "[name].cjs" },
        },
      },
    },
  };
});
