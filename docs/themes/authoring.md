# Writing a theme

This page is the authoring reference for Pear Desktop themes: the folder
contract, manifest validation, palette and preset resolution, the Basic theme's
YouTube Music recolour, the script lifecycle, and the security model. For
installing, selecting and customising themes, see [Using themes](./index.md).

## Folder layout

```text
<userData>/themes/my-theme/
  theme.json     required
  style.css      named by theme.json
  theme.js       named by theme.json
```

- One folder per theme, directly inside the themes directory. The folder name
  is the theme id; nested folders are not read.
- `theme.json` is required. Files named by the manifest are read relative to
  the theme folder; other files in the folder are ignored.
- A folder without a readable, valid `theme.json` is skipped with a warning and
  does not appear in the app.
- Themes are listed in folder-name order (`localeCompare`), which is the order
  used by the Settings dropdown and the native menu.

## Manifest fields

```json
{
  "name": "Solarized",
  "description": "Dark Solarized palette for YouTube Music",
  "author": "you",
  "palette": {
    "accent": "#b58900",
    "background": "#002b36",
    "surface": "#073642",
    "text": "#93a1a1"
  },
  "presets": {
    "high-contrast": { "text": "#ffffff", "background": "#000000" }
  },
  "css": ["reset.css", "style.css"],
  "js": "theme.js"
}
```

| Field         | Type                                   | Required | Effect                                                                 |
| ------------- | -------------------------------------- | -------- | ---------------------------------------------------------------------- |
| `name`        | `string`                               | no       | Display name; defaults to the folder name.                             |
| `description` | `string`                               | no       | Tooltip on the theme's entry in the native menu.                       |
| `author`      | `string`                               | no       | Metadata only; it is read into the loaded theme but not displayed.     |
| `palette`     | `Record<string, string>`               | no       | Values emitted as `--pear-theme-<key>` variables and editable by users. |
| `presets`     | `Record<string, Record<string, string>>` | no     | Named alternates layered over `palette`.                               |
| `css`         | `string \| string[]`                   | no       | One or more stylesheets, injected in the declared order.              |
| `js`          | `string`                               | no       | One script file, consent-gated; see [Scripts](#scripts).              |

`theme.json` is plain JSON, so it cannot contain comments. A theme may define
any palette keys, not only the four roles the Basic theme uses; `accent`,
`background`, `surface` and `text` are a convention, not a contract.

## Validation and loading

`parseManifest()` (`src/themes/types.ts`) validates the manifest when the folder
is read. The folder is skipped with `[themes] invalid theme.json in <folder>,
skipping` when:

- the file is not valid JSON;
- the JSON root is not an object (an array or a bare string is rejected);
- `palette` is present but is not an object whose values are all strings;
- `presets` is present but is not an object of palette objects;
- `css` is present but is neither a string nor an array of strings;
- `js` is present but is not a string.

Only those four fields are type-checked; unknown fields are ignored. `name`,
`description` and `author` are not validated, so pass strings.

Loading is deliberately tolerant after the manifest parses:

| Situation                                   | Result                                                        |
| ------------------------------------------- | ------------------------------------------------------------- |
| A declared CSS file is missing or unreadable | Warning `[themes] could not read <path>, skipping`; that file is dropped, the rest load. |
| No readable CSS at all                       | The theme loads with an empty stylesheet.                      |
| The declared `js` file is missing           | Warning `[themes] <id>: js file "<file>" is missing, theme has no script`; the theme keeps its CSS and has no script. |
| `css` repeats a file or lists several      | Contents are concatenated in order, joined by a newline, into one stylesheet. |
| The folder has no manifest                  | Warning `[themes] could not read <path>, skipping`; it is not treated as a theme. |

Paths are resolved by joining them to the theme folder. They are relative by
convention; the reader does not confine them to the folder, so a manifest can
name a path outside it with `..`.

## Palette

Every `palette` entry becomes a `--pear-theme-<key>` custom property. The
palette is emitted for the selected theme as a single `:root` block:

```json
{ "palette": { "accent": "#22c55e", "font": "monospace", "radius": "8px" } }
```

```css
/* injected by the app */
:root {
  --pear-theme-accent: #22c55e;
  --pear-theme-font: monospace;
  --pear-theme-radius: 8px;
}
```

```css
/* your stylesheet consumes them */
ytmusic-player-bar {
  font-family: var(--pear-theme-font);
  border-radius: var(--pear-theme-radius);
}
```

Rules that matter:

- Values are emitted verbatim, so any CSS value works: colours, fonts, lengths,
  shadows. The engine does not parse or validate them.
- Keys become part of the property name verbatim; use lower-case kebab-case
  (`scrollbar-width`). The Settings editor displays them title-cased, splitting
  on `-`, `_` and whitespace.
- The palette is injected **after** the theme's CSS. A key the palette defines
  therefore beats the same `--pear-theme-<key>` declared in your stylesheet,
  which is what lets user edits override the theme's values and lets a palette
  entry replace a derived variable such as `--pear-theme-accent-light`.
- The engine emits only the selected theme's palette. Other themes' palettes
  are not global.
- Users edit every key under **Settings ▸ Appearance ▸ Theme ▸ Colors**, and
  may add keys your manifest never defined. Those edits live in config
  (`options.themeOverrides`), not in your folder, and the palette block is
  rebuilt from them on each apply.

## Recolouring YouTube Music

The engine does not recolour anything for you. A palette only defines variables;
the stylesheet decides what consumes them. The Basic theme ships the recolour as
an ordinary `style.css`, and that file is the recipe to copy: open **Options ▸
Visual Tweaks ▸ Theme ▸ Open themes folder**, then copy `basic/style.css` into
your theme folder and edit it, or declare your own rules.

Basic maps YouTube Music's CSS variables onto its four roles:

| Role         | YouTube Music variable                                       |
| ------------ | ------------------------------------------------------------ |
| `background` | `--ytmusic-color-black3`                                     |
| `background` | `--ytmusic-color-black4`                                     |
| `background` | `--ytmusic-color-blackpure`                                  |
| `background` | `--yt-spec-base-background`                                  |
| `background` | `--yt-spec-general-background-b`                             |
| `background` | `--yt-spec-general-background-c`                             |
| `background` | `--yt-spec-snackbar-background`                              |
| `background` | `--yt-spec-black-pure`                                       |
| `background` | `--yt-spec-black-1-alpha-98`                                 |
| `background` | `--yt-spec-static-overlay-background-solid`                  |
| `background` | `--ytmusic-search-background`                                |
| `background` | `--ytmusic-background`                                       |
| `surface`    | `--ytmusic-color-black1`                                     |
| `surface`    | `--ytmusic-color-black2`                                     |
| `surface`    | `--dark-theme-background-color`                              |
| `surface`    | `--yt-spec-raised-background`                                |
| `surface`    | `--yt-spec-menu-background`                                  |
| `surface`    | `--yt-sys-color-baseline--menu-background`                   |
| `surface`    | `--yt-spec-general-background-a`                             |
| `surface`    | `--yt-spec-filled-button-text`                               |
| `surface`    | `--yt-spec-static-brand-black`                               |
| `surface`    | `--paper-toast-background-color`                             |
| `surface`    | `--paper-dialog-background-color`                            |
| `text`       | `--yt-spec-text-primary`                                     |
| `text`       | `--yt-spec-text-secondary`                                   |
| `text`       | `--ytmusic-text-primary`                                     |
| `text`       | `--yt-sys-color-baseline--text-primary`                      |
| `text`       | `--ytmusic-overlay-text-secondary` (text at 70%, transparent) |
| `text`       | `--ytmusic-icon-inactive` (via `--pear-theme-text-dim`)      |
| `accent`     | `--paper-progress-active-color`                              |
| `accent`     | `--yt-sys-color-baseline--call-to-action`                    |
| `accent`     | `--icon-color`                                               |
| `accent`     | `--paper-toggle-button-checked-bar-color` (via `--pear-theme-accent-light`) |
| `accent`     | `--primary-color`                                            |
| `accent`     | `--paper-progress-active-color-1`                            |
| `accent`     | `--paper-progress-active-color-2`                            |
| `accent`     | `--paper-slider-knob-color`                                  |
| `accent`     | `--paper-slider-knob-start-color`                            |

It also styles a few elements and their descendants directly:

| Selector                                                                                 | Property           | Value                       |
| ---------------------------------------------------------------------------------------- | ------------------ | --------------------------- |
| `:root`                                                                                  | `background`       | `--pear-theme-background`   |
| `ytmusic-dialog`                                                                         | `background-color` | `--pear-theme-surface`      |
| `ytmusic-app-layout`                                                                     | `color`            | `--pear-theme-text`         |
| `.title.ytmusic-player-bar`                                                              | `color`            | `--pear-theme-text`         |
| `.time-info.ytmusic-player-bar`, `.summary.ytmusic-setting-boolean-renderer`             | `color`            | `--pear-theme-text-dim`     |
| `.background-gradient.style-scope`, `ytmusic-app-layout[is-bauhaus-sidenav-enabled] #mini-guide-background.ytmusic-app-layout` | `background` | `--ytmusic-background` |
| `#progress-bar.ytmusic-player-bar`, `.seekbar-theme #progress-bar.ytmusic-player-bar`     | `--paper-progress-active-color-1`, `-2`, `--paper-slider-knob-color`, `--paper-slider-knob-start-color` | `--pear-theme-accent` |

The declarations that repoint YouTube Music's variables, and the element rules,
use `!important` because YouTube Music sets the same properties itself. The
list is what Basic covers, not every variable YouTube Music exposes: add your
own rules for surfaces it misses, and target the page's elements directly
(`ytmusic-app-layout`, `ytmusic-player-bar`, `ytmusic-guide-renderer`, and so
on).

Where YouTube Music wants a shade the four roles do not carry, Basic derives
one. These are ordinary custom properties readable from your own CSS, but they
are **not emitted by the engine**: they are declared in Basic's stylesheet, so a
theme with its own `style.css` has to define them (or copy Basic's) if it wants
them:

| Variable                    | Definition                                                          | Used for                                    |
| --------------------------- | ------------------------------------------------------------------- | ------------------------------------------- |
| `--pear-theme-accent-light` | `color-mix(in srgb, var(--pear-theme-accent) 65%, white)`           | checked toggle bar                          |
| `--pear-theme-text-dim`     | `color-mix(in srgb, var(--pear-theme-text) 70%, black)`             | inactive icons, player time, settings summary |

A palette entry with either name overrides the derived value, because the
palette is injected after the stylesheet.

## Presets

`presets` is an object of named palettes. Each preset is layered over the
theme's own `palette`, so it only has to list what it changes, and it may
introduce keys the palette never defined.

```json
{
  "palette": { "accent": "#ff0000", "background": "#030303", "text": "#ffffff" },
  "presets": {
    "blue": { "accent": "#0000ff", "background": "#0303aa" },
    "compact": { "radius": "4px" }
  }
}
```

Resolution is implemented by `defaultPreset()` and `presetPalette()` in
`src/themes/types.ts`:

| Stored pick                                  | Layer applied over the theme's palette                  |
| -------------------------------------------- | ------------------------------------------------------- |
| a preset name the theme defines              | that preset's values                                    |
| a preset name the theme no longer defines    | nothing (the theme's palette shows through)             |
| `custom`                                     | the user's edited palette                               |
| `''` (Default), or no entry, with a `palette` declared | nothing (Default is the palette as written)    |
| `''` (Default), or no entry, with no `palette` | the first preset in manifest order                    |

Behavior worth knowing when you design a manifest:

- A theme with no `palette` key has no Default to offer. Its first preset stands
  in for Default and is applied until the user picks another; the picker shows
  that theme's presets and Custom, without a Default entry.
- An explicit `"palette": {}` is a declaration, not an omission: it still offers
  Default, and the first preset is reached only by picking it.
- Preset keys are display names after title-casing, so `high-contrast` reads as
  **High Contrast** in both the Settings picker and the native menu.
- `custom` is reserved for the palette the user edits. A manifest preset named
  `custom` would never be applied.
- An empty preset (`{}`) is valid: it layers nothing.
- Presets are listed in manifest key order, which decides which one stands in
  for a missing Default.
- The user's pick is stored per theme in `options.themePresets`; editing a
  colour or adding a variable switches the pick to `custom`, seeded from the
  preset that was active.

## Scripts

A theme script handles what CSS cannot: toggling classes on `body`, observing
the DOM, or reacting to player state. Declare it in the manifest:

```json
{ "name": "My Theme", "palette": { "accent": "#22c55e" }, "js": "theme.js" }
```

The script is CommonJS and must assign its hooks to `module.exports`:

```js
// theme.js
module.exports = {
  mount(context) {
    document.body.classList.add('my-theme');

    // Optional cleanup: runs before `unmount` when the theme is replaced.
    return () => document.body.classList.remove('my-theme');
  },
  unmount() {
    // Optional; runs after the cleanup returned by `mount`.
  },
};
```

### The script contract

`src/themes/renderer.ts` evaluates the source as
`new Function('module', 'exports', source)(module, module.exports)`. The folder
is not bundled or transpiled, so:

- `module.exports` is the only supported export shape. `export default` is not
  provided; a comment in `src/themes/types.ts` mentions it being transpiled, but
  the reader in `src/themes/renderer.ts` only passes `module` and `exports` to
  `new Function`, so ESM syntax does not run. `import` and `require` are not
  provided either.
- The module body runs first, then `mount` is called immediately. Put DOM work
  in `mount` so it can be paired with cleanup; top-level work has no matching
  teardown.
- Only the selected theme's script runs, and only when the user consented to its
  current hash.

`mount(context)` receives:

| Property          | Type                                     | Meaning                                                                 |
| ----------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| `context.id`      | `string`                                 | The theme id (folder name).                                             |
| `context.palette` | `Record<string, string>`                 | The effective palette: theme palette plus the active preset or user edits. |
| `context.applyPalette` | `(partial: Record<string, string>) => void` | Merges values over the mount-time palette and injects them as another palette block. |

`mount` may return a cleanup function; `unmount` is optional. When the theme is
replaced, the cleanup runs first and `unmount` second. Errors from evaluation,
`mount`, cleanup and `unmount` are caught and logged with `[themes]`
prefixes - they do not roll back the theme's CSS.

Lifecycle rules:

- `mount` does not re-run when the palette, a preset or a custom colour changes.
  CSS-only recolours are handled by the palette injection; DOM work set up in
  `mount` survives a recolour.
- The script is torn down when the theme changes, when the selected theme is
  cleared, when the script's source hash changes, or when the script stops being
  available. A changed source is mounted again only after the user allows it.
- `applyPalette` is transient. It merges over the palette captured at mount
  time and appends a style element; the next theme refresh (theme switch, preset
  switch, colour edit) clears injected styles and does not re-run `mount`. Use
  it for colour driven by page state, not for values the user should keep.
- Theme scripts share the page context with the app's preload bridge. They are
  not sandboxed; see [Security](#security).

Consent is pinned to the file, which is why `js` has to be declared rather than
auto-discovered: the app hashes the exact source (`hashThemeJs()`, SHA-256 hex)
and stores the allowed hash per theme id in `options.themeConsent`. A script
whose hash is not recorded is withheld from the renderer entirely. Editing
`theme.js` re-prompts; editing CSS or `theme.json` does not. The user-facing
flow is in [Scripts and consent](./index.md#scripts-and-consent).

## Testing and debugging

The theme engine is covered by three tests beside the app's other cross-cutting
tests:

| Test file                       | Covers                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `tests/themes-load.test.ts`     | Folder reading, name fallback, CSS concatenation order, skipped folders/manifests, missing CSS files, folder-name ordering, absent vs empty palette. |
| `tests/themes-manifest.test.ts` | Manifest validation, `paletteToCss()` output, palette resolution, Default/preset resolution, `normalizeThemeState()` defaults. |
| `tests/themes-consent.test.ts`  | Script reading and hashing, missing script fallback, hash changes only with the script contents, consent matching. |

Run them with the repo's Playwright-based node runner (`pnpm test`); see
[Tests](../conventions.md#tests) for the general test conventions. The tests use
temporary directories, never the real themes folder.

To iterate on a theme:

1. Add or edit the folder's files. There is no file watcher: the folders are
   re-read at startup and on each theme refresh (selecting a theme, changing a
   preset or colour, importing a stylesheet). Restart the app after editing an
   already-selected theme to be certain the new files are loaded.
2. A newly added folder appears in **Settings ▸ Appearance ▸ Theme** when the
   settings UI next reads the list; the native Options menu is built at startup
   and after in-app imports, so restart to see it there.
3. A theme whose manifest is invalid, or whose CSS/JS files are missing, logs a
   warning with a `[themes]` prefix. The renderer's console also reports
   evaluation and lifecycle errors from scripts.

Common symptoms:

| Symptom                                      | Likely cause                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| The theme does not appear in any list        | `theme.json` failed validation, the folder is not directly inside the themes directory, or the menu has not been rebuilt. |
| The theme applies but nothing changes        | No `css` is declared (a palette alone recolours nothing), or the CSS does not consume the palette variables. |
| The Colors editor is missing                 | The resolved palette is empty: no `palette`, no preset values and no user edits.                |
| A script never runs                          | Consent has not been given for the current hash, the `js` file is missing, or evaluation/mount threw (check the console). |
| The consent dialog reappears every start     | The script file's bytes change between launches (regenerated file, line-ending change).         |

## Security

**Theme scripts are unsandboxed.** A script runs in the YouTube Music window
with the same access as a plugin's renderer code: it can read and change the
app's settings through the preload bridge, send and receive IPC, make network
requests, and modify the page. The consent dialog is the only gate, and it is
pinned to the exact script source - there is no sandbox, capability list or
permission model beyond that.

For the app-side view of consent, script withholding and withdrawal, see
[Scripts and consent](./index.md#scripts-and-consent). For how plugins are
loaded and what the same renderer access means in practice, see
[Plugins](../plugins/index.md).
