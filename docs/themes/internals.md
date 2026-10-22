# Theme engine internals

The theme engine is split between the main process, which owns the files and consent state, and the renderer, which injects the selected theme into the YouTube Music page.

## How a theme is applied

1. **Reading.** `loadThemes()` in `src/themes/main.ts` scans the themes directory with `readThemesFrom()` in `src/themes/load.ts`. Each folder's `theme.json` is parsed and validated, the declared CSS files are concatenated in order and the declared script's source is hashed with SHA-256. A folder that fails validation is skipped with a warning; unreadable CSS files are dropped; a missing script file degrades to a theme with no script.
2. **Filtering.** `themesForRenderer()` returns themes with the script removed unless `options.themeConsent[id]` matches the script's hash.
3. **Serving.** The renderer asks for the state over the `peard:get-themes` channel, handled in `src/index.ts`. The response contains the filtered theme list, the selected id and `overrides`, the value layer each theme currently applies. `themePaletteLayers()` computes that layer per theme with `presetPalette()`, so a preset or colour edit needs no reload.
4. **Applying.** `src/themes/renderer.ts` fetches the state at startup after renderer plugins load, normalizes it and applies the selected theme. It removes the previous style elements, then appends the theme's concatenated CSS as one `<style>` element when it has any, then appends the resolved palette as another `:root` block of `--pear-theme-*` custom properties. Because the palette is injected after the theme's own CSS, stored overrides win over values the theme shipped. If the theme's script is present and its identity, meaning its id and hash, changed, `mount` runs.
5. **Refreshing.** Main pushes `peard:themes-changed` to the window, and the renderer re-reads and re-applies. This is what makes switching themes, presets and colours take effect without a restart. A palette or preset change does not remount the script; only a different theme or script does.

The renderer's script identity check is `{ id, hash }`. Palette edits clear and re-inject styles but keep the mounted script. The full implementation is in `src/themes/renderer.ts`.

## Main process handlers

The main process exposes these IPC handlers in `src/index.ts`:

- `peard:get-themes`
- `peard:create-theme-from-css`
- `peard:open-themes-folder`
- `peard:get-themes-dir`

The menu and settings window call the same underlying functions directly. The main theme functions are in `src/themes/main.ts`; manifest parsing and palette resolution are in `src/themes/types.ts`.

## Configuration keys

All theme state lives in the app's config store, `config.json` under `<userData>`, managed by electron-store.

| Key | Type | Meaning |
| --- | --- | --- |
| `options.theme` | `string` | Selected theme id; `''` means no theme. |
| `options.themePresets` | `Record<string, string>` | Preset pick per theme id: a preset name, `custom` or `''` for Default. |
| `options.themeOverrides` | `Record<string, Record<string, string>>` | Custom palette per theme id. It is used when the stored preset pick is `custom` and is seeded from the active preset while editing. |
| `options.themeConsent` | `Record<string, string>` | SHA-256 of the script source the user allowed, per theme id. |
| `options.themesSeeded` | `boolean` | Whether the one-time theme seeding step has run. |

`options.themes` is retired. The legacy list of CSS paths is migrated and the key removed at startup. See [The Basic theme and migrations](./using.md#the-basic-theme).

The default config in `src/config/defaults.ts` is `theme: ''`, empty records for `themePresets`, `themeOverrides` and `themeConsent`, and `themesSeeded: false`. A config written before these keys existed is tolerated by electron-store's defaults and by the `?? {}` fallbacks in the theme getters in `src/config/index.ts`. Separately, `normalizeThemeState()` fills in the renderer response fields `themes`, `selected` and `overrides` so a missing field cannot crash startup.

## Palette resolution layer

`themePaletteLayers()` in `src/themes/main.ts` loads the themes, reads the stored preset picks and custom palettes, and calls `presetPalette()` for each theme. The result maps theme id to the layer that the renderer should merge over the theme's own palette.

`resolvePalette()` in `src/themes/types.ts` merges that layer over the palette. The layer always wins. A preset or colour edit therefore only needs the new layer, not a new copy of the theme folder or script.

## Selection state and pruning

Theme state is keyed by folder name. Removing or renaming a folder leaves the old id's stored state behind until `pruneMissingThemes()` runs at startup. At that point the app removes the missing id's palette overrides, preset pick and script consent. If the missing id was selected, the selection is reset to **No theme**.

The renderer can keep using its already-loaded copy until it refreshes. The folder itself is not watched; see [Adding, updating and removing themes](./using.md#adding-updating-and-removing-themes).
