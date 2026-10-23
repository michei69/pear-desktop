# Using themes

This page covers selecting, importing and customising themes. To create or modify a theme folder, see [Writing a theme](./authoring.md).

## Where themes live

The themes directory is `<userData>/themes` (`getThemesDir()` in `apps/desktop/src/main/themes.ts`). Open it from **Options ▸ Theme ▸ Open themes folder**, or from the same button in **Settings ▸ Appearance ▸ Theme**.

- Only immediate subdirectories are considered. A theme folder's own subdirectories are not searched for manifests.
- Theme folders are listed in folder-name order.
- The folder name is the id used for every stored setting: the selection, preset pick, colour edits and script consent. Renaming a folder makes it a different theme and prunes the old id's state.
- CSS and JS paths are joined to the folder. Relative paths are the convention, but the reader does not confine them. See [Path resolution](./manifest.md#path-resolution).
- The host polls the folder every second. New, edited and deleted themes are noticed without restarting the app.

## Selecting a theme

There are two ways to switch:

- **Settings ▸ Appearance ▸ Theme** shows a dropdown with **No theme** and every valid theme. When the selected theme supports them, the preset picker and colour editor also appear.
- **Options ▸ Theme** shows a radio list of **No theme** and the same themes, plus a Presets submenu for themes that define presets, the import action and the folder button.

The selection is stored in `options.theme` and applies immediately: the previous theme's sheets are removed and its script is unmounted, then the new theme's CSS and palette are applied and its script is mounted when consented. Choosing **No theme** stores an empty id and removes everything the previous theme added.

Selecting a theme whose script is not allowed for its current hash first shows the consent dialog. Declining leaves the previous selection in place.

The native menu is built from the theme list when the app builds the menu. A hand-made folder found by the poll appears in Settings and in the page right away; in the native menu it appears after the next menu rebuild or restart.

## Importing CSS files

If you already have a stylesheet, the app can wrap it in a theme folder:

- **Options ▸ Theme ▸ Import custom CSS file** opens a multi-select dialog.
- The same action exists as a button in **Settings ▸ Appearance ▸ Theme**, which opens the same picker.

Importing writes a new folder under the themes directory and selects it. The theme id is a slug of the first file's name: lowercased, characters outside ASCII `a-z` and `0-9` collapsed to `-`, leading and trailing hyphens removed, with `-2`, `-3` and so on if the id is taken. A name that produces an empty slug falls back to `theme`. Files are copied as follows:

| Imported files | Files in the theme folder |
| --- | --- |
| one `foo.css` | `style.css` |
| several | `1-foo.css`, `2-bar.css`, ... |

The generated `theme.json` has a `name` from the first file, the copied `css` list and an empty `palette`. Imported themes carry no script, so no consent prompt appears. Edit the manifest afterwards to add a palette, presets or a script. See [Theme manifest](./manifest.md).

## Presets

A theme can ship named alternates of its palette. When the selected theme declares at least one preset, a **Preset** picker appears in the Theme card, and the native menu gains **Options ▸ Theme ▸ Presets ▸ *theme name***.

The picker offers:

| Entry | What it applies | Stored as |
| --- | --- | --- |
| **Default** | the theme's own `palette` | `''` |
| *Preset* | that preset's values layered over the palette | preset name |
| **Custom** | your own edited palette, layered over the palette | `custom` |

A preset lists only what it changes: its values win over the palette, and it may introduce variables the palette never defined. A preset's display name comes from its key, so `high-contrast` reads as **High Contrast**.

Resolution rules when a manifest changes:

- A theme with no `palette` key has no Default. Its first preset stands in and is applied until you pick something else. The picker offers that theme's presets and Custom, without a Default entry.
- `"palette": {}` is a declaration, not an omission. It still offers Default, and the first preset is reached only by picking it.
- If the theme stops defining the preset you picked, the name stays in config but layers nothing, so the theme's own palette shows.
- `custom` is reserved for the palette you edit. A manifest preset named `custom` can never be selected.

The pick is stored per theme id in `options.themePresets`. A missing entry means you have never chosen for that theme. Switching theme or preset applies immediately. See [Palettes and presets](./palettes.md).

## Colors

The **Colors** editor in the Theme card shows the selected theme's resolved palette: the theme's own palette merged with the active preset or your custom layer. Each row has the variable name in title case (`scrollbar-width` reads as **Scrollbar Width**), a text input and a swatch.

- Values are arbitrary CSS values: `#22c55e`, `monospace`, `8px` and so on.
- **Add variable** adds a key the theme never defined. Your CSS can consume it.
- Editing a value or adding a variable switches the preset pick to **Custom**. The custom palette starts from the active preset's values, so a preset doubles as a starting point.
- **Reset colors** drops the custom palette and the preset pick, returning the theme to Default: its own palette and, for a palette-less theme, its first preset.
- Edits are stored per theme in `options.themeOverrides`, never written back to the theme folder, so they survive a theme update.
- The editor shows a note when the resolved palette is empty, as with a CSS-only import or a theme with neither palette nor presets, and still offers the add-variable row.

Switching to another preset keeps your custom palette stored. It applies again when you pick Custom and is deleted only by **Reset colors** or by removing the theme folder.

## Scripts and consent

A theme may ship a script for work CSS cannot do: toggling classes on `body`, observing the DOM or reacting to page state. A script runs in the YTM page and is not sandboxed. It has the same access as plugin page code: it can read and change your settings, talk to the app, make network requests and modify the page. Treat a theme with a script exactly like running code from its author.

Because of that, scripts are gated:

1. The first time you select a theme whose script is new or changed since you last allowed it, the app shows a warning dialog titled **Run theme code?** with the theme's name and an explanation that the code runs with full access to the app. **Cancel** is the default button.
2. Allowing records the SHA-256 hash of the script file's contents in `options.themeConsent`, keyed by theme id. Consent is pinned to that exact source. Editing `theme.js` changes the hash, so the changed script is withheld until you allow it again from the Theme card or select the theme again.
3. Until the hash matches, the host withholds the script from the page. The theme's CSS still applies; only the script is absent. The Theme card shows an **Allow** button while a declared script is blocked.
4. Editing CSS or non-script manifest metadata does not re-prompt. Changing the `js` path can select a different script, so it prompts for the new source.
5. At startup the app checks the selected theme's script and prompts when it is new or changed. Declining leaves the theme selected without its script; its CSS still applies.

To withdraw consent, delete the theme's folder. Its consent entry is pruned when the folder list is re-read. Replacing `theme.js` with different code also works as a withdrawal: the recorded hash no longer matches, so the script does not run until you allow the new source.

The script contract and security model are in [Theme scripts](./scripts.md).

## The Basic theme

On the first start with the theme engine, the app seeds a **Basic** theme when the themes directory contains no valid theme folders. It is gated by `options.themesSeeded`, so it happens once.

Basic is an ordinary theme folder:

- Its palette defines four roles: `accent` `#ff0000`, `background` `#030303`, `surface` `#1f1f1f` and `text` `#ffffff`.
- Its `style.css` maps YTM's own variables onto those values, so it is also the reference for recolouring. See [Styles and recolouring](./styles.md).

You can edit Basic, copy it as a starting point or delete it. If you delete it, it is not re-created, because `options.themesSeeded` is already set.

Two upgrade paths run at startup:

- **Basic upgrade.** An earlier seed wrote a palette but no stylesheet, for example with `"css": []`. If a folder literally named `basic` has no CSS of its own, the app writes `style.css` and points the manifest at it, preserving the rest of the manifest. A `basic` folder with its own CSS is left alone.
- **Legacy `options.themes`.** pear-desktop 3.x stored a list of CSS file paths in `options.themes`. When such paths still exist, the app copies them into one new theme folder named after the first file, selects it if no theme is selected and removes the old key. Missing paths are dropped.

## Adding, updating and removing themes

**Adding:** create a folder with a valid `theme.json`. The poll notices it within a second; it appears in Settings and applies when selected. The native menu updates on its next rebuild or at the next start.

**Updating:** the poll re-reads the files every second. Edits to the selected theme's CSS, palette, manifest or script apply on the next check. A changed script needs new consent first.

**Removing:** delete the folder. Within a second the theme disappears, its CSS and script are removed if it was selected, and the stored overrides, preset pick and consent for that id are pruned. If it was selected, the selection resets to **No theme**. A folder renamed to a new id is treated as a new theme; the old id's state is pruned.
