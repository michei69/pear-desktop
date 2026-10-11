import {
  normalizeThemeState,
  paletteToCss,
  resolvePalette,
  type ThemeHooks,
  type ThemePalette,
  type ThemeState,
} from './types';

let state: ThemeState = { themes: [], selected: '', overrides: {} };
let injected: HTMLStyleElement[] = [];
/** The mounted theme, kept whole so teardown uses that theme's own hooks. */
let mounted: { id: string; hash: string; hooks: ThemeHooks } | null = null;
let cleanup: (() => void) | null = null;

const clearInjected = () => {
  for (const element of injected) element.remove();
  injected = [];
};

const inject = (css: string) => {
  const element = document.createElement('style');
  element.textContent = css;
  document.head.appendChild(element);
  injected.push(element);
};

/**
 * Runs a theme script with a CommonJS-style `module`/`exports` pair, so it can
 * `module.exports = { mount, unmount }`. It only reaches here after the user
 * consented to this exact source, so the eval warnings are suppressed.
 */
/* oxlint-disable typescript/no-implied-eval, typescript/no-unsafe-call */
const evaluate = (source: string, id: string): ThemeHooks | null => {
  try {
    const module = { exports: {} as ThemeHooks };
    new Function('module', 'exports', source)(module, module.exports);
    return module.exports;
  } catch (err) {
    console.error(`[themes] failed to evaluate script for "${id}":`, err);
    return null;
  }
};
/* oxlint-enable typescript/no-implied-eval, typescript/no-unsafe-call */

const teardown = () => {
  if (mounted) {
    try {
      cleanup?.();
    } catch (err) {
      console.error(`[themes] cleanup for "${mounted.id}" threw:`, err);
    }
    try {
      mounted.hooks.unmount?.();
    } catch (err) {
      console.error(`[themes] unmount for "${mounted.id}" threw:`, err);
    }
  }

  cleanup = null;
  mounted = null;
};

const applyTheme = () => {
  const theme = state.selected
    ? state.themes.find((entry) => entry.id === state.selected)
    : undefined;

  // Only the selected theme's script, and only when it changes.
  const identity = theme?.js ? { id: theme.id, hash: theme.js.hash } : null;
  const unchanged =
    mounted !== null &&
    identity !== null &&
    mounted.id === identity.id &&
    mounted.hash === identity.hash;
  const isNewScript = identity !== null && (mounted === null || !unchanged);

  // Palette edits must not remount: only a different theme or script tears down.
  if (mounted && !unchanged) teardown();

  clearInjected();
  if (!theme) return;

  const palette = resolvePalette(
    theme.palette,
    state.overrides[theme.id] ?? {},
  );

  // Theme CSS first, palette after, so a user override always beats what the
  // theme shipped.
  if (theme.css) inject(theme.css);
  inject(paletteToCss(palette));

  if (theme?.js && isNewScript) {
    const hooks = evaluate(theme.js.source, theme.id) ?? {};
    if (hooks.mount) {
      try {
        const result = hooks.mount({
          id: theme.id,
          palette,
          applyPalette: (next: ThemePalette) =>
            inject(paletteToCss(resolvePalette(palette, next))),
        });
        cleanup = typeof result === 'function' ? result : null;
      } catch (err) {
        console.error(`[themes] mount for "${theme.id}" threw:`, err);
      }
    }
    mounted = { id: theme.id, hash: theme.js.hash, hooks };
  }
};

const refresh = async () => {
  // Read from main, not window.mainConfig: its store may not see main's writes yet.
  const payload = (await window.ipcRenderer.invoke(
    'peard:get-themes',
  )) as Partial<ThemeState>;

  state = normalizeThemeState(payload);

  applyTheme();
};

export const initThemes = async () => {
  // A theme failure must not abort renderer startup.
  try {
    await refresh();
  } catch (err) {
    console.error('Failed to load themes:', err);
  }

  window.ipcRenderer.on('peard:themes-changed', () => {
    refresh().catch((err) => console.error('Failed to apply theme:', err));
  });
};
