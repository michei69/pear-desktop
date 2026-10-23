// The selected theme, applied in YTM: its CSS, then the resolved palette, then
// whatever the theme's script adds with `applyPalette`. The host withholds a
// script until the user consented to its exact hash, so anything that arrives
// here may run.

import { paletteToCss, resolvePalette, type ThemeHooks, type ThemePalette, type ThemeState } from "@pear/sdk/themes";
import { setThemeSheets, styleSheet } from "@pear/sdk/stylesheets";

/**
 * Runs a theme script with a CommonJS-style `module`/`exports` pair, so it can
 * `module.exports = { mount, unmount }`. It only reaches here after the user
 * consented to this exact source.
 */
/* oxlint-disable typescript/no-implied-eval -- theme scripts are the feature */
const evaluate = (source: string, id: string): ThemeHooks | null => {
  try {
    const module: { exports: ThemeHooks } = { exports: {} };
    const run = new Function("module", "exports", source) as (module: { exports: ThemeHooks }, exports: ThemeHooks) => void;
    run(module, module.exports);
    return module.exports;
  } catch (error) {
    console.error(`[themes] failed to evaluate script for "${id}":`, error);
    return null;
  }
};
/* oxlint-enable typescript/no-implied-eval */

export class ThemesRuntime {
  #themeSheet: CSSStyleSheet | undefined;
  #paletteSheet: CSSStyleSheet | undefined;
  /** What the mounted script's `applyPalette` emitted, after the palette. */
  #scriptSheets: CSSStyleSheet[] = [];
  /** The mounted theme, kept whole so teardown uses that theme's own hooks. */
  #mounted: { id: string; hash: string; hooks: ThemeHooks } | null = null;
  #cleanup: (() => void) | null = null;

  /** Applies a theme state; a palette-only change keeps the script running. */
  apply(state: ThemeState) {
    const theme = state.selected ? state.themes.find((entry) => entry.id === state.selected) : undefined;
    const identity = theme?.js ? { id: theme.id, hash: theme.js.hash } : null;
    const unchanged =
      this.#mounted !== null && identity !== null && this.#mounted.id === identity.id && this.#mounted.hash === identity.hash;

    if (this.#mounted && !unchanged) this.#teardown();

    const palette: ThemePalette = theme ? resolvePalette(theme.palette, state.overrides[theme.id] ?? {}) : {};
    this.#themeSheet = theme?.css ? styleSheet(theme.css) : undefined;
    this.#paletteSheet = theme ? styleSheet(paletteToCss(palette)) : undefined;
    this.#publish();

    if (theme?.js && !unchanged) this.#mount(theme.id, theme.js.source, theme.js.hash, palette);
  }

  #publish() {
    const sheets = [this.#themeSheet, this.#paletteSheet, ...this.#scriptSheets].filter(
      (sheet): sheet is CSSStyleSheet => sheet !== undefined,
    );
    setThemeSheets(sheets);
  }

  #mount(id: string, source: string, hash: string, palette: ThemePalette) {
    const hooks = evaluate(source, id) ?? {};
    if (hooks.mount) {
      try {
        const result = hooks.mount({
          id,
          palette,
          applyPalette: (next) => {
            this.#scriptSheets.push(styleSheet(paletteToCss(resolvePalette(palette, next))));
            this.#publish();
          },
        });
        this.#cleanup = typeof result === "function" ? result : null;
      } catch (error) {
        console.error(`[themes] mount for "${id}" threw:`, error);
      }
    }
    this.#mounted = { id, hash, hooks };
  }

  #teardown() {
    if (this.#mounted) {
      try {
        this.#cleanup?.();
      } catch (error) {
        console.error(`[themes] cleanup for "${this.#mounted.id}" threw:`, error);
      }
      try {
        this.#mounted.hooks.unmount?.();
      } catch (error) {
        console.error(`[themes] unmount for "${this.#mounted.id}" threw:`, error);
      }
    }

    this.#cleanup = null;
    this.#mounted = null;
    this.#scriptSheets = [];
  }
}
