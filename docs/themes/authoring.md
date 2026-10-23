# Writing a theme

This page is the starting point for theme authors. It covers the folder contract and the quickest way to make a working theme. The details are split into focused pages:

- [Theme manifest](./manifest.md): all `theme.json` fields, validation and loading behavior.
- [Palettes and presets](./palettes.md): palette variables, user edits and preset resolution.
- [Styles and recolouring](./styles.md): stylesheet loading and the Basic theme's recolour.
- [Theme scripts](./scripts.md): the script contract, consent and security.
- [Theme engine internals](./internals.md): application flow and stored configuration.
- [Testing and debugging](./debugging.md): tests, warnings and common problems.

For selecting, importing, customising or removing themes through the app, see [Using themes](./using.md).

## Folder layout

```text
<userData>/themes/my-theme/
  theme.json     required
  style.css      named by theme.json
  theme.js       named by theme.json, optional
```

- One folder per theme, directly inside the themes directory. The folder name is the theme id; nested folders are not read.
- `theme.json` is required. Files named by the manifest are read relative to the theme folder; other files in the folder are ignored.
- A folder without a readable, valid `theme.json` is skipped with `[themes] invalid theme.json in <folder>, skipping` (or a read warning) and does not appear in the app.
- Themes are listed in folder-name order, which is the order used by the Settings dropdown and the native menu.
- Renaming the folder changes the theme id. Stored selection, preset, colour and consent state is keyed by id, so the renamed theme starts without that state.

The exact manifest rules are in [Theme manifest](./manifest.md). `theme.json` is plain JSON and cannot contain comments.

## Quick start

There are two practical ways to start:

1. Import an existing CSS file with **Options ▸ Theme ▸ Import custom CSS file** or the corresponding button in **Settings ▸ Appearance ▸ Theme**. The app creates a theme folder with a generated `theme.json` and selects it.
2. Open **Options ▸ Theme ▸ Open themes folder**, copy the **Basic** theme's `theme.json` and `style.css` into a new folder, then edit the copy.

The palette is only a bag of variables; the recolouring itself is CSS. The quickest recolouring theme is a copy of Basic's two files with your own palette:

```json
{
  "name": "Solarized",
  "description": "Dark Solarized palette for YTM",
  "author": "you",
  "palette": {
    "accent": "#b58900",
    "background": "#002b36",
    "surface": "#073642",
    "text": "#93a1a1"
  },
  "css": "style.css"
}
```

A palette is optional. A theme with no variables to expose can be just CSS:

```json
{ "name": "Rounded", "css": "style.css" }
```

```css
/* themes/rounded/style.css */
ytmusic-player-bar {
  border-radius: 12px;
}
```

Add a `js` file only when you need something CSS cannot do, such as toggling a class on `body`. See [Theme scripts](./scripts.md).

## Manifest at a glance

```json
{
  "name": "My Theme",
  "description": "Optional one-liner",
  "author": "You",
  "palette": {
    "accent": "#22c55e",
    "background": "#0a0a0a",
    "surface": "#141414",
    "text": "#e5e7eb"
  },
  "presets": {
    "blue": { "accent": "#3b82f6", "background": "#0b1220" },
    "compact": { "radius": "4px" }
  },
  "css": ["reset.css", "style.css"],
  "js": "theme.js"
}
```

| Field | Type | Required | Effect |
| --- | --- | --- | --- |
| `name` | `string` | no | Display name. Defaults to the folder name. |
| `description` | `string` | no | Shown under the theme name in Settings. |
| `author` | `string` | no | Shown as a pill next to the theme name in Settings. |
| `palette` | `Record<string, string>` | no | Values emitted as `--pear-theme-<key>` variables and editable by users. |
| `presets` | `Record<string, Record<string, string>>` | no | Named alternates layered over `palette`. |
| `css` | `string \| string[]` | no | One or more stylesheets, concatenated in the declared order. |
| `js` | `string` | no | One script file, consent-gated. |

A theme may define any palette keys, not only the four roles Basic uses. `accent`, `background`, `surface` and `text` are a convention, not a contract. See [Palettes and presets](./palettes.md).

## Next steps

- Read [Theme manifest](./manifest.md) before relying on validation or file loading.
- Copy Basic's rules or write your own in [Styles and recolouring](./styles.md).
- Use [Theme scripts](./scripts.md) only when CSS cannot do the job, and review the security model first.
- Use [Testing and debugging](./debugging.md) when the theme does not appear, does not apply or a script does not run.
