# Themes

This page explains how Pear Desktop themes work for users: where theme folders
live, how to select, import and customise one, and what the script consent
prompt means. Theme authors should start with [Writing a theme](./authoring.md).

## What a theme is

The app reads theme folders from `<userData>/themes`, where `<userData>` is
Electron's per-user data directory for the app (`app.getPath('userData')` in
`src/themes/main.ts`). A theme is one folder directly inside that directory
containing a `theme.json` manifest; the folder name is the theme's id. The
manifest names the CSS files and, optionally, one script, all relative to the
folder:

```text
<userData>/themes/
  basic/
    theme.json
    style.css
  my-theme/
    theme.json
    style.css
    theme.js
```

At most one theme is selected at a time. Its CSS is injected into the YouTube
Music window while it is selected; its script, if it has one and you allowed it,
is mounted alongside. Selecting **No theme** injects nothing, so YouTube Music
looks as it does without the app.

Manifests are validated each time the folder is read. A folder whose manifest
fails validation is skipped with a console warning and does not appear in the
pickers; the exact rules are in [Validation and
loading](./authoring.md#validation-and-loading).

## Where themes live

The themes directory is `<userData>/themes` (`getThemesDir()` in
`src/themes/main.ts`). Open it from **Options ▸ Visual Tweaks ▸ Theme ▸ Open
themes folder**, or from the same button under **Settings ▸ Appearance ▸
Theme**.

- Only the immediate subdirectories of the themes directory are considered; a
  theme folder's own subdirectories are not searched for manifests.
- Themes are listed in folder-name order.
- The folder name is the id used for every stored setting: the selection, the
  preset pick, your colour edits and the script consent. Renaming the folder
  therefore makes it a different theme, with none of the old state.
- CSS and JS paths in `theme.json` are relative to the theme folder.

## Selecting a theme

There are two ways to switch:

- **Settings ▸ Appearance ▸ Theme** - a theme dropdown listing **No theme**
  followed by every valid theme, plus the preset picker and colour editor
  described below when the selected theme supports them.
- **Options ▸ Visual Tweaks ▸ Theme** - a radio list of **No theme** and the
  same themes.

The selection is stored in `options.theme`. It applies immediately, without a
restart: the previous theme's style elements are removed and its script
unmounted, then the new theme's CSS and palette are injected and its script
mounted. Choosing **No theme** stores an empty id and removes everything the
previous theme added.

Selecting a theme whose script is not yet allowed for its current hash first
shows the consent dialog; declining leaves the previous selection in place.

The Options menu is built when the application starts and rebuilt by the app's
menu refreshes (a plugin toggle that needs a submenu, an in-app theme import).
A hand-made theme folder appears in Settings when Settings next reads the list,
and in the Options menu after one of those rebuilds or a restart. Section
[Adding, updating and removing themes](#adding-updating-and-removing-themes)
covers the details.

## Importing a CSS file

If you already have a stylesheet, the app can wrap it in a theme folder for
you:

- **Options ▸ Visual Tweaks ▸ Theme ▸ Import custom CSS file** opens a
  multi-select dialog.
- The same action exists as a button under **Settings ▸ Appearance ▸ Theme**;
  it imports one file at a time.

Importing writes a new folder under the themes directory and selects it. The
theme's id is a slug of the first file's name (lowercased, non-alphanumerics
collapsed to `-`, with `-2`, `-3`, ... added if the id is taken). The files are
copied as follows:

| Imported files | Files in the theme folder |
| -------------- | ------------------------- |
| one `foo.css`  | `style.css`               |
| several        | `1-foo.css`, `2-bar.css`, ... |

The generated `theme.json` has a `name` from the first file, the copied `css`
list, and an empty `palette`. Imported themes carry no script, so no consent
prompt appears. Edit the manifest afterwards to add a palette, presets or a
script; see [Writing a theme](./authoring.md).

## Presets

A theme can ship named alternates of its palette. When the selected theme
declares at least one preset, a **Preset** picker appears in **Settings ▸
Appearance ▸ Theme**, and the native menu gains **Options ▸ Visual Tweaks ▸
Theme ▸ Presets ▸ *theme name***.

The picker offers:

| Entry       | What it applies                                   | Stored as    |
| ----------- | ------------------------------------------------- | ------------ |
| **Default** | the theme's own `palette`                         | `''`         |
| *Preset*    | that preset's values layered over the palette     | preset name  |
| **Custom**  | your own edited palette, layered over the palette | `custom`     |

A preset only lists what it changes: its values win over the palette, and it
may introduce variables the palette never defined. A preset's display name is
derived from its key, so `high-contrast` reads as **High Contrast**.

A few resolution rules matter when a manifest changes:

- A theme that declares no `palette` key has no Default. Its first preset
  stands in and is applied until you pick something else; the picker then
  offers that theme's presets and Custom, without a Default entry.
- `"palette": {}` is a declaration, not an omission: it still offers Default,
  and the first preset is reached only by picking it.
- If the theme stops defining the preset you picked, the name is kept in config
  but layers nothing, so the theme's own palette shows.
- `custom` is reserved for the palette you edit yourself. A manifest preset
  named `custom` can never be selected.

The pick is stored per theme id in `options.themePresets`; a missing entry means
you have never chosen for that theme. Switching theme or preset applies
immediately.

## Colors

The **Colors** editor under **Settings ▸ Appearance ▸ Theme** lists every
variable available for the selected theme: its palette, the values of the
active preset, and your own edits. Each row shows the variable name in
title case (`scrollbar-width` reads as **Scrollbar Width**), a text input, and a
swatch.

- Values are arbitrary CSS values, not only colours: `#22c55e`,
  `monospace`, `8px` and so on.
- **Add variable** adds a key the theme never defined; your CSS can consume it.
- Editing a value or adding a variable switches the preset pick to **Custom**.
  The custom palette starts from the values of the preset that was active, so a
  preset doubles as a starting point.
- **Reset colors** drops your custom palette and the preset pick, returning the
  theme to Default (its own palette and, for a palette-less theme, its first
  preset).
- Edits are stored per theme in `options.themeOverrides`, never written back to
  the theme folder, so they survive an update of the theme's own files.
- The editor is hidden when the theme has no palette variables to show, as with
  a CSS-only import or a theme whose manifest declares neither palette nor
  presets.

Switching to another preset keeps your custom palette stored; it is applied
again when you pick Custom. It is not deleted until **Reset colors** or until
the theme folder is removed.

## Scripts and consent

A theme may ship a script for work CSS cannot do: toggling classes on `body`,
observing the DOM, or reacting to the page. A script runs in the YouTube Music
window and **is not sandboxed**. It has the same access as a plugin's renderer
code - it can read and change your settings, send messages to the app, and make
network requests. Treat a theme with a script exactly like running code from
whoever wrote the theme.

Because of that, scripts are gated:

1. The first time you select a theme whose script is new or changed since you
   last allowed it, the app shows a warning dialog titled **Run theme code?**
   with the theme's name and an explanation that the code will run with full
   access to the app. **Cancel** is the default button.
2. Allowing records the SHA-256 hash of the script file's contents in
   `options.themeConsent`, keyed by theme id. Consent is pinned to that exact
   source; editing `theme.js` changes the hash and prompts again.
3. Until the hash matches, the main process withholds the script from the
   renderer entirely (`themesForRenderer` in `src/themes/main.ts`). The theme's
   CSS still applies; only the script is absent.
4. Editing CSS or `theme.json` does not re-prompt, because neither can execute.
5. At startup the app checks the selected theme's script and prompts when it is
   new or changed. Declining there leaves the theme selected but without its
   script; its CSS still applies.

To withdraw consent, delete the theme's folder. Its consent entry is pruned on
the next start, along with the rest of its stored state. Replacing `theme.js`
with different code also takes effect as a withdrawal: the recorded hash no
longer matches, so the script does not run until you allow the new source.

The script authoring contract - lifecycle, `mount` context and cleanup - is in
[Scripts](./authoring.md#scripts).

## The Basic theme

On the first start with the theme engine, the app seeds a **Basic** theme when
the themes directory contains no valid theme folders. It is gated by
`options.themesSeeded` in config, so it happens once, not on every launch.

Basic is an ordinary theme folder:

- Its palette defines four roles: `accent` `#ff0000`, `background` `#030303`,
  `surface` `#1f1f1f` and `text` `#ffffff`.
- Its `style.css` maps YouTube Music's own variables onto those four values, so
  it is also the reference for recolouring; see [Recolouring YouTube
  Music](./authoring.md#recolouring-youtube-music).

You can edit it, copy it as a starting point, or delete it. If you delete it, it
is not re-created, because `options.themesSeeded` is already set.

Two upgrade paths run at startup:

- **Basic upgrade.** An earlier seed wrote a palette but no stylesheet (for
  example, its manifest carried `"css": []`). If a folder literally named
  `basic` has no CSS of its own, the app writes `style.css` and points the
  manifest at it, preserving the rest of the manifest. A `basic` folder that
  already has CSS is left alone.
- **Legacy `options.themes`.** The previous custom-theme plugin stored a list of
  CSS file paths in `options.themes`. When such paths still exist, the app
  copies them into one new theme folder named after the first file, selects it
  if no theme is selected, and removes the old key. Missing paths are dropped.

## Adding, updating and removing themes

**Adding:** Create a folder with a valid `theme.json` (see [Folder layout](./authoring.md#folder-layout)). It is picked up when the app next reads the theme list: reopening Settings is enough to select it there. The native Options menu is built at startup and on later menu rebuilds, so restart the app - or import through the app - for a hand-made folder to appear there.

**Updating:** Theme files are re-read whenever the app refreshes its theme state: at startup, when a theme is selected, and when a preset or colour is changed. There is no file watcher, so after editing an already-selected theme's files, restart (or make any theme change) to see the new version.

**Removing:** Delete the folder. Its CSS stops applying the next time the theme state is refreshed; until then the renderer keeps working from the copy it loaded. On the next start the app prunes everything stored for that id - custom palette, preset pick and script consent - and if the theme was selected, the selection resets to **No theme**. A folder renamed to a new id is treated as a new theme; the old id is pruned.

## How a theme is applied

The engine is split between the main process, which owns the files, and the
renderer, which owns the page:

1. **Reading.** `loadThemes()` (`src/themes/main.ts`) scans the themes directory
   with `readThemesFrom()` (`src/themes/load.ts`). Each folder's `theme.json` is
   parsed and validated, the declared CSS files are concatenated in order, and
   the declared script's source is hashed with SHA-256. A folder that fails
   validation is skipped with a warning; unreadable CSS files are dropped;
   a missing script file degrades to a theme with no script.
2. **Filtering.** `themesForRenderer()` returns the themes with the script
   removed unless `options.themeConsent[id]` matches the script's hash.
3. **Serving.** The renderer asks for the state over the `peard:get-themes`
   channel, handled in `src/index.ts`. It returns the filtered theme list, the
   selected id, and `overrides`: the value layer each theme currently applies.
   `themePaletteLayers()` computes that layer per theme with `presetPalette()`,
   so a preset or colour edit needs no reload.
4. **Applying.** `src/themes/renderer.ts` fetches that state at startup (after
   renderer plugins load), normalizes it, and applies the selected theme: it
   removes the previous style elements, then appends the theme's concatenated
   CSS as one `<style>` (when it has any), then appends the resolved palette as
   another `:root` block of `--pear-theme-*` custom properties. Because the
   palette is injected after the theme's own CSS, your stored overrides win
   over values the theme shipped. If the theme's script is present and its
   identity (id and hash) changed, `mount` runs.
5. **Refreshing.** Main pushes `peard:themes-changed` to the window, and the
   renderer re-reads and re-applies. This is what makes switching themes,
   presets and colours take effect without a restart. A palette or preset
   change does not remount the script; only a different theme or script does.

The main process also exposes `peard:create-theme-from-css`,
`peard:open-themes-folder` and `peard:get-themes-dir` handlers in
`src/index.ts`; the menu and settings window call the same functions directly.

## Configuration keys

All theme state lives in the app's config store (`config.json` under
`<userData>`, managed by electron-store):

| Key                      | Type                                     | Meaning                                                                  |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------ |
| `options.theme`          | `string`                                 | Selected theme id; `''` means no theme.                                  |
| `options.themePresets`   | `Record<string, string>`                 | Preset pick per theme id: a preset name, `custom`, or `''` for Default.  |
| `options.themeOverrides` | `Record<string, Record<string, string>>` | Custom palette per theme id, layered over the theme's palette and preset. |
| `options.themeConsent`   | `Record<string, string>`                 | SHA-256 of the script source the user allowed, per theme id.             |
| `options.themesSeeded`   | `boolean`                                | Whether the one-time theme seeding step has run.                         |

`options.themes` is retired: the legacy list of CSS paths is migrated and the
key removed at startup.

The default config (`src/config/defaults.ts`) is `theme: ''`, empty records for
`themePresets`, `themeOverrides` and `themeConsent`, and `themesSeeded: false`.
A config written before these keys existed is tolerated by
`normalizeThemeState()`, which fills in empty defaults instead of failing.

## See also

- [Writing a theme](./authoring.md) - manifest fields, palette and CSS
  reference, script contract, security notes.
- [Plugins](../plugins/index.md) - how plugin code is loaded, for comparison
  with theme scripts.
- [Conventions](../conventions.md) - contribution rules for code and docs.
