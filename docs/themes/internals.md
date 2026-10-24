# Theme engine internals

The theme engine is split between the main process, which owns the files, consent and configuration, and the page runtime, which applies the selected theme inside YTM.

## How a theme is applied

1. **Reading.** `Themes.start()` scans `<userData>/themes` with `readThemesFrom()` (`apps/desktop/src/main/theme-load.ts`). Each folder's `theme.json` is parsed by `parseManifest()`, the declared CSS files are concatenated in order, and a declared script's source is hashed with SHA-256. A folder that fails validation is skipped with a warning; unreadable CSS files are dropped; a missing script file degrades to a theme without a script.
2. **Seeding and migration.** The first start after install seeds a Basic theme when no valid theme folder exists, then records `options.themesSeeded`. `upgradeBasicTheme()` gives an older Basic folder the current stylesheet when it has none. Legacy `options.themes` CSS paths are copied into a folder and the key is removed.
3. **Filtering.** `Themes.state()` returns every theme, but replaces the script of a theme whose hash is not in `options.themeConsent` with `jsBlocked: true`. It also returns the selected id, the stored preset picks and, per theme, the layer its preset or custom palette applies.
4. **Watching.** The engine polls the folders every second (`POLL_MS`). A changed folder list or file content pushes a `themes` event to the YTM window, and `Themes.#pruneMissingThemes()` drops selection, preset, palette and consent entries for ids that no longer exist.
5. **Serving.** The page runtime receives the state in its bootstrap and on every `themes` event. The settings window receives the same event types it subscribes to.
6. **Applying.** `ThemesRuntime.apply()` in `packages/page/src/themes.ts` resolves the palette with `resolvePalette(theme.palette, state.overrides[id])`, builds constructed style sheets for the theme CSS and the palette, and replaces the theme sheets at the end of `document.adoptedStyleSheets`. This makes theme CSS win over plugin CSS while the palette wins over the theme's own values.
7. **Scripts.** If the theme has a script and its `{ id, hash }` identity changed, the old script is torn down and the new one is evaluated. A palette or preset change keeps the mounted script and any sheets it added with `applyPalette`; it does not call `mount` again.

The renderer's identity check means a script is remounted only for a different theme or a changed script source, not for colour edits.

## Host methods

`Themes` (`apps/desktop/src/main/themes.ts`) exposes:

- `start()`, `stop()`: seeding, migration, polling and the startup consent prompt.
- `all`, `selected`, `presets`: the loaded themes, the selected id and preset picks.
- `state()`: the payload sent to the page.
- `select(id, win?)`: selects a theme, asking for script consent first; false when declined.
- `allowScript(id, win?)`: records consent to the current script.
- `setPreset(themeId, preset)`, `setPaletteValue(themeId, key, value)`, `resetPalette(themeId)`.
- `import(paths?, win?)`: creates a theme folder from CSS files.
- `openFolder()`: opens the themes directory.
- `onChange` and `onCatalogChange` callbacks from the constructor: one for any state change, one for a new folder (used to rebuild the menu).

The settings model calls these through bridge commands: `theme:select`, `theme:allow-script`, `theme:set-preset`, `theme:set-palette-value`, `theme:reset-palette`, `theme:import` and `theme:open-folder`. The native menu calls the same methods directly.

`ensureJsConsent()` shows the "Run theme code?" dialog. At startup, `#consentSelected()` asks for the selected theme without a window. Declining leaves the selection and withholds the script.

## Configuration keys

All theme state lives in `config.json` under `<userData>`, inside `options`:

| Key | Type | Meaning |
| --- | --- | --- |
| `options.theme` | `string` | Selected theme id; `''` means no theme. |
| `options.themePresets` | `Record<string, string>` | Preset pick per theme id: a preset name, `custom`, or `''` for Default. |
| `options.themeOverrides` | `Record<string, Record<string, string>>` | Custom palette per theme id. Used when the stored pick is `custom`, seeded from the active preset while editing. |
| `options.themeConsent` | `Record<string, string>` | SHA-256 of the script source the user allowed, per theme id. |
| `options.themesSeeded` | `boolean` | Whether the one-time seed step has run. |
| `options.themes` | `string[]` | Retired. The pear-desktop 3.x CSS path list, migrated once and then removed. |

`Settings.themeConfig()` in `apps/desktop/src/main/config.ts` reads these keys with fallbacks, so a config written before they existed works. `Settings.setThemeConfig()` writes a partial patch and schedules the config write.

## Palette resolution

`Themes.#paletteLayers()` loads the stored preset picks and custom palettes and calls `presetPalette()` for each theme. The result maps theme id to the values layered over its palette. `resolvePalette()` merges that layer over the theme's own palette, with the layer winning.

The page receives the layers, so a preset or colour change only needs a new state, not a new folder read. `palettes.md` documents the resolution table.

## Selection state and pruning

Theme state is keyed by folder name. Deleting or renaming a folder removes the id from the loaded list; `#pruneMissingThemes()` then:

- removes its palette overrides, preset pick and script consent;
- resets `options.theme` to `''` when that theme was selected.

The poll runs this whenever the folder list changes, so stale entries do not accumulate and a later theme reusing the same folder name does not inherit them. A renamed folder starts with fresh state.

## Consent and withholding

The script source is read and hashed on every folder read. `isJsConsented()` compares the hash with the stored consent value. The page never receives a source whose hash is not consented. A `jsBlocked` theme still has its CSS and palette, and the Theme card shows **Allow** so the user can consent without reselecting the theme.

Consent applies per theme id, not per file name. Moving a script to another file changes the hash and asks again.

## Tests

The pure parts (manifest parsing, palette resolution, `paletteToCss`, `normalizeThemeState`) live in `packages/sdk/src/themes.ts`; the folder reading and hashing live in `apps/desktop/src/main/theme-load.ts`; the host orchestration is `apps/desktop/src/main/themes.ts`; the page application is `packages/page/src/themes.ts`.

Vitest tests for the desktop app live in `apps/desktop/test/`. Run `nub run test`. See [Testing and debugging](./debugging.md) for the practical checklist.
