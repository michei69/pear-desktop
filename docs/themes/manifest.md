# Theme manifest

Every theme folder must contain a readable `theme.json` manifest. The manifest names the theme's CSS files and optional script and can expose palette variables and presets.

## Fields

| Field | Type | Required | Effect |
| --- | --- | --- | --- |
| `name` | `string` | no | Display name. Defaults to the folder name. |
| `description` | `string` | no | Shown in the Theme card. |
| `author` | `string` | no | Shown as a pill in the Theme card. |
| `palette` | `Record<string, string>` | no | Values emitted as `--pear-theme-<key>` variables and editable by users. See [Palettes and presets](./palettes.md). |
| `presets` | `Record<string, Record<string, string>>` | no | Named alternates layered over `palette`. |
| `css` | `string \| string[]` | no | One or more stylesheets, applied in the declared order. See [Styles and recolouring](./styles.md). |
| `js` | `string` | no | One script file, consent-gated. See [Theme scripts](./scripts.md). |

`theme.json` is plain JSON, so it cannot contain comments. A theme may define any amount of palette keys.

A complete example:

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
  "presets": {
    "high-contrast": { "text": "#ffffff", "background": "#000000" }
  },
  "css": ["reset.css", "style.css"],
  "js": "theme.js"
}
```

## Validation and loading

`parseManifest()` in `packages/sdk/src/themes.ts` parses and validates the manifest; `readTheme()` in `apps/desktop/src/main/theme-load.ts` applies it. A folder is skipped with a warning when:

- `theme.json` is missing or unreadable;
- the file is not valid JSON;
- the root is not an object (an array or a bare string is rejected);
- `palette` is present but is not an object whose values are all strings;
- `presets` is present but is not an object of palette objects;
- `css` is present but is neither a string nor an array of strings;
- `js` is present but is not a string.

Those four fields are type-checked. Unknown fields are ignored. `name`, `description` and `author` are not validated; pass strings.

Loading after a successful parse is deliberately tolerant:

| Situation | Result |
| --- | --- |
| A declared CSS file is missing or unreadable | `[themes] could not read <path>, skipping`; that file is dropped and the rest load. |
| No readable CSS at all | The theme loads with an empty stylesheet. |
| The declared JS file is missing | `[themes] <id>: js file "<file>" is missing, theme has no script`; CSS still applies. |
| `css` repeats a file or lists several files | Contents are concatenated in order with a newline into one stylesheet. |
| The folder has no `theme.json` | A read warning; it is not treated as a theme. |

A folder with a valid manifest appears in the theme lists. A removed or renamed folder disappears when the folders are next polled, which happens every second while the app runs; its stored overrides, preset pick and script consent are pruned at the same time. See [Using themes](./using.md#adding-updating-and-removing-themes).

## Optional and absent fields

- `name` falls back to the folder name.
- An absent `palette` is not the same as an empty palette. If `palette` is absent, the theme's first preset can stand in for Default. An explicit `"palette": {}` keeps Default. The full rules are in [Palettes and presets](./palettes.md).
- An absent `css` produces no theme sheet. A palette alone does not recolour anything, but it is still emitted.
- An absent `js` means the theme has no script. `js` must be declared rather than auto-discovered because consent is pinned to the exact script source.
- An invalid manifest skips the whole theme. A missing declared file only removes that file after the manifest has parsed.

## Path resolution

CSS and JS paths are joined to the theme folder. They are relative by convention, but the reader does not confine them to the folder, so a manifest can name a path outside it with `..`. The app reads the named paths directly with the filesystem.

For normal themes, keep declared CSS and JS files inside the theme folder and use names such as `style.css`, `theme.js` or `css/extra.css`.

## Loading result

For each valid folder, `readTheme()` produces a theme object with:

- `id`, the folder name.
- `name`, from the manifest or the folder name.
- `description` and `author`, when present.
- `palette` only when the manifest declares one.
- `presets`, when present.
- `css`, the concatenated contents of all readable declared stylesheets.
- `js`, containing the script source and its SHA-256 hash, when the declared file is readable.
- `jsBlocked: true`, added by the host when a script exists but the user has not consented to its current hash.
