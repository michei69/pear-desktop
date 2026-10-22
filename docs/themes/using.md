# Using themes

This page covers selecting, importing and customising themes. To create or modify a theme folder, see [Writing a theme](./authoring.md).

## Where themes live

The themes directory is `<userData>/themes` (`getThemesDir()` in `src/themes/main.ts`). Open it from **Options ▸ Visual Tweaks ▸ Theme ▸ Open themes folder**, or from the same button under **Settings ▸ Appearance ▸ Theme**.

- Only immediate subdirectories of the themes directory are considered. A theme folder's own subdirectories are not searched for manifests.
- Theme folders are listed in folder-name order.
- The folder name is the id used for every stored setting: the selection, the preset pick, your colour edits and the script consent. Renaming a folder therefore makes it a different theme and leaves the old id's state to be pruned.
- CSS and JS paths are joined to the theme folder. Relative paths are the convention, but the loader does not confine them to the folder. See [Path resolution](./manifest.md#path-resolution).

## Selecting a theme

There are two ways to switch:

- **Settings ▸ Appearance ▸ Theme** shows a dropdown listing **No theme** followed by every valid theme. When the selected theme supports them, the preset picker and colour editor also appear here.
- **Options ▸ Visual Tweaks ▸ Theme** shows a radio list of **No theme** and the same themes.

The selection is stored in `options.theme`. It applies immediately without restarting: the previous theme's style elements are removed and its script is unmounted, then the new theme's CSS and palette are injected and its script is mounted. Choosing **No theme** stores an empty id and removes everything the previous theme added.

Selecting a theme whose script is not yet allowed for its current hash first shows the consent dialog. Declining that dialog leaves the previous selection in place.

The Options menu is built when the application starts and rebuilt by the app's menu refreshes, such as a plugin toggle that needs a submenu or an in-app theme import. A hand-made theme folder appears in Settings when Settings next reads the list, and in the Options menu after one of those rebuilds or a restart. See [Adding, updating and removing themes](#adding-updating-and-removing-themes).

## Importing a CSS file

If you already have a stylesheet, the app can wrap it in a theme folder for you:

- **Options ▸ Visual Tweaks ▸ Theme ▸ Import custom CSS file** opens a multi-select dialog.
- The same action exists as a button under **Settings ▸ Appearance ▸ Theme** and imports one file at a time.

Importing writes a new folder under the themes directory and selects it. The theme id is a slug of the first file's name: it is lowercased, characters outside ASCII `a-z` and `0-9` are collapsed to `-`, leading and trailing hyphens are removed, and `-2`, `-3`, and so on are added if the id is taken. A name that produces an empty slug falls back to `theme`. The files are copied as follows:

| Imported files | Files in the theme folder |
| --- | --- |
| one `foo.css` | `style.css` |
| several | `1-foo.css`, `2-bar.css`, ... |

The generated `theme.json` has a `name` taken from the first file, the copied `css` list and an empty `palette`. Imported themes carry no script, so no consent prompt appears. Edit the manifest afterwards to add a palette, presets or a script. See [Theme manifest](./manifest.md).

## Presets

A theme can ship named alternates of its palette. When the selected theme declares at least one preset, a **Preset** picker appears in **Settings ▸ Appearance ▸ Theme**, and the native menu gains **Options ▸ Visual Tweaks ▸ Theme ▸ Presets ▸ *theme name***.

The picker offers:

| Entry | What it applies | Stored as |
| --- | --- | --- |
| **Default** | the theme's own `palette` | `''` |
| *Preset* | that preset's values layered over the palette | preset name |
| **Custom** | your own edited palette, layered over the palette | `custom` |

A preset only lists what it changes: its values win over the palette, and it may introduce variables the palette never defined. A preset's display name is derived from its key, so `high-contrast` reads as **High Contrast**.

A few resolution rules matter when a manifest changes:

- A theme that declares no `palette` key has no Default. Its first preset stands in and is applied until you pick something else. The picker then offers that theme's presets and Custom, without a Default entry.
- `"palette": {}` is a declaration, not an omission. It still offers Default, and the first preset is reached only by picking it.
- If the theme stops defining the preset you picked, the name is kept in config but layers nothing, so the theme's own palette shows.
- `custom` is reserved for the palette you edit yourself. A manifest preset named `custom` can never be selected.

The pick is stored per theme id in `options.themePresets`; a missing entry means you have never chosen for that theme. Switching theme or preset applies immediately. See [Palettes and presets](./palettes.md) for the authoring details and resolution implementation.

## Colors

The **Colors** editor under **Settings ▸ Appearance ▸ Theme** shows the selected theme's resolved palette: the theme's own palette merged with the active preset or the user's custom layer. Each row shows the variable name in title case (`scrollbar-width` reads as **Scrollbar Width**), a text input and a swatch. Every resolved palette entry appears here for the user to modify.

- Values are arbitrary CSS values, not only colours: `#22c55e`, `monospace`, `8px` and so on.
- **Add variable** adds a key the theme never defined. Your CSS can consume it.
- Editing a value or adding a variable switches the preset pick to **Custom**. The custom palette starts from the values of the preset that was active, so a preset doubles as a starting point.
- **Reset colors** drops your custom palette and the preset pick, returning the theme to Default: its own palette and, for a palette-less theme, its first preset.
- Edits are stored per theme in `options.themeOverrides`, never written back to the theme folder, so they survive an update of the theme's own files.
- The editor is hidden when the theme has no palette variables to show, as with a CSS-only import or a theme whose manifest declares neither palette nor presets.

Switching to another preset keeps your custom palette stored. It is applied again when you pick Custom. It is not deleted until **Reset colors** or until the theme folder is removed.

## Scripts and consent

A theme may ship a script for work CSS cannot do: toggling classes on `body`, observing the DOM or reacting to page state. A script runs in the YouTube Music window and **is not sandboxed**. It has the same access as a plugin's renderer code: it can read and change your settings, send messages to the app, make network requests and modify the page. Treat a theme with a script exactly like running code from whoever wrote the theme.

Because of that, scripts are gated:

1. The first time you select a theme whose script is new or changed since you last allowed it, the app shows a warning dialog titled **Run theme code?** with the theme's name and an explanation that the code will run with full access to the app. **Cancel** is the default button.
2. Allowing records the SHA-256 hash of the script file's contents in `options.themeConsent`, keyed by theme id. Consent is pinned to that exact source. Editing `theme.js` changes the hash; there is no file watcher, so the changed script stays withheld until the user selects the theme again or the app next starts and asks for consent.
3. Until the hash matches, the main process withholds the script from the renderer entirely (`themesForRenderer` in `src/themes/main.ts`). The theme's CSS still applies; only the script is absent.
4. Editing CSS or non-script manifest metadata does not re-prompt, because neither can execute. Changing the `js` path can select a different script, so it prompts for consent to the new source.
5. At startup the app checks the selected theme's script and prompts when it is new or changed. Declining there leaves the theme selected but without its script; its CSS still applies.

To withdraw consent, delete the theme's folder. Its consent entry is pruned on the next start, along with the rest of its stored state. Replacing `theme.js` with different code also takes effect as a withdrawal: the recorded hash no longer matches, so the script does not run until you allow the new source.

The script authoring contract, lifecycle and security model are in [Theme scripts](./scripts.md).

## The Basic theme

On the first start with the theme engine, the app seeds a **Basic** theme when the themes directory contains no valid theme folders. It is gated by `options.themesSeeded` in config, so it happens once, not on every launch.

Basic is an ordinary theme folder:

- Its palette defines four roles: `accent` `#ff0000`, `background` `#030303`, `surface` `#1f1f1f` and `text` `#ffffff`.
- Its `style.css` maps YouTube Music's own variables onto those four values, so it is also the reference for recolouring. See [Styles and recolouring](./styles.md).

You can edit Basic, copy it as a starting point or delete it. If you delete it, it is not re-created, because `options.themesSeeded` is already set.

Two upgrade paths run at startup:

- **Basic upgrade.** An earlier seed wrote a palette but no stylesheet, for example with `"css": []`. If a folder literally named `basic` has no CSS of its own, the app writes `style.css` and points the manifest at it, preserving the rest of the manifest. A `basic` folder that already has CSS is left alone.
- **Legacy `options.themes`.** The previous custom-theme plugin stored a list of CSS file paths in `options.themes`. When such paths still exist, the app copies them into one new theme folder named after the first file, selects it if no theme is selected and removes the old key. Missing paths are dropped.

## Adding, updating and removing themes

**Adding:** Create a folder with a valid `theme.json`. See [Folder layout](./authoring.md#folder-layout) and [Theme manifest](./manifest.md). The folder is picked up when the app next reads the theme list: reopening Settings is enough to select it there. The native Options menu is built at startup and on later menu rebuilds, so restart the app or import through the app for a hand-made folder to appear there.

**Updating:** Theme files are re-read whenever the app refreshes its theme state: at startup, when a theme is selected and when a preset or colour is changed. There is no file watcher, so after editing an already-selected theme's files, restart or make any theme change to see the new version. The running theme is not updated automatically.

**Removing:** Delete the folder. There is no remove action inside the app itself. Its CSS stops applying the next time the theme state is refreshed; until then the renderer keeps working from the copy it loaded. On the next start the app prunes everything stored for that id, including custom palette, preset pick and script consent. If the theme was selected, the selection resets to **No theme**. A folder renamed to a new id is treated as a new theme; the old id is pruned.
