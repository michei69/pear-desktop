# Theme manifest

Every theme folder must contain a readable `theme.json` manifest. The manifest names the theme's CSS files and optional script and can expose palette variables and presets.

## Fields

| Field | Type | Required | Effect |
| --- | --- | --- | --- |
| `name` | `string` | no | Display name. Defaults to the folder name. |
| `description` | `string` | no | Tooltip on the theme's entry in the native menu. |
| `author` | `string` | no | Metadata only. It is read into the loaded theme but is not displayed. |
| `palette` | `Record<string, string>` | no | Values emitted as `--pear-theme-<key>` variables and editable by users. See [Palettes and presets](./palettes.md). |
| `presets` | `Record<string, Record<string, string>>` | no | Named alternates layered over `palette`. See [Presets](./palettes.md#presets). |
| `css` | `string \| string[]` | no | One or more stylesheets, injected in the declared order. See [Styles and recolouring](./styles.md). |
| `js` | `string` | no | One script file, consent-gated. See [Theme scripts](./scripts.md). |

`theme.json` is plain JSON, so it cannot contain comments. A theme may define any amount of palette keys.

A complete example:

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

## Validation and loading

`parseManifest()` in `src/themes/types.ts` validates the manifest when the folder is read. The folder is skipped with `[themes] invalid theme.json in <folder>, skipping` when:

- the file is not valid JSON;
- the JSON root is not an object, so an array or a bare string is rejected;
- `palette` is present but is not an object whose values are all strings;
- `presets` is present but is not an object of palette objects;
- `css` is present but is neither a string nor an array of strings;
- `js` is present but is not a string.

Only those four fields are type-checked. Unknown fields are ignored. `name`, `description` and `author` are not validated, so pass strings.

Loading is deliberately tolerant after the manifest parses:

| Situation | Result |
| --- | --- |
| A declared CSS file is missing or unreadable | Warning `[themes] could not read <path>, skipping`; that file is dropped and the rest load. |
| No readable CSS at all | The theme loads with an empty stylesheet. |
| The declared JS file is missing | Warning `[themes] <id>: js file "<file>" is missing, theme has no script`; the theme keeps its CSS and has no script. |
| `css` repeats a file or lists several files | Contents are concatenated in order, joined by a newline, into one stylesheet. |
| The folder has no manifest | Warning `[themes] could not read <path>, skipping`; it is not treated as a theme. |

A folder with a valid manifest appears in the app's theme lists. A removed or renamed folder disappears when the folder list is next read. Its stored palette overrides, preset pick and script consent are pruned only during the next app start; see [Adding, updating and removing themes](./using.md#adding-updating-and-removing-themes).

## Optional and absent fields

- `name` falls back to the folder name.
- An absent `palette` is not the same as an empty palette. If `palette` is absent, the theme's first preset can stand in for Default. An explicit `"palette": {}` keeps Default. The full rules are in [Presets](./palettes.md#presets).
- An absent `css` produces an empty stylesheet. A palette alone does not recolour anything.
- An absent `js` means the theme has no script. `js` must be declared rather than auto-discovered because consent is pinned to the exact script source.
- An invalid manifest skips the whole theme. A missing declared file only removes that file after the manifest has parsed.

## Path resolution

CSS and JS paths are resolved by joining them to the theme folder. They are relative by convention, but the reader does not confine them to the folder, so a manifest can name a path outside it with `..`. The app reads the named paths directly with the filesystem.

For normal themes, keep declared CSS and JS files inside the theme folder and use file names such as `style.css` or paths such as `css/extra.css`.

## Loading result

For each valid folder, the loader produces a theme object with:

- `id`, the folder name.
- `name`, from the manifest or the folder name.
- `description` and `author`, when present.
- `palette` only when the manifest declares one.
- `presets`, when present.
- `css`, the concatenated contents of all readable declared stylesheets, joined with newlines.
- `js`, containing the script source and its SHA-256 hash, when the declared file is readable.

The exact implementation is in `src/themes/load.ts`, with manifest parsing and palette helpers in `src/themes/types.ts`.
