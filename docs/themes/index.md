# Themes

Pear Desktop themes are external folders read from `<userData>/themes`, where `<userData>` is Electron's per-user data directory for the app. A theme is one folder directly inside that directory. Its folder name is the theme id, and its `theme.json` manifest names the CSS files and, optionally, one script to use.

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

At most one theme is selected at a time. Selecting a theme applies its CSS and palette; if it has a script and you have allowed that exact script, the script also runs. **No theme** injects nothing, so YTM looks as it does without the app.

Themes are managed from **Options ▸ Theme** and **Settings ▸ Appearance ▸ Theme**. Theme authors work in the same folders with the manifest, stylesheet and optional script described here.

## Documentation map

| Goal | Read |
| --- | --- |
| Install, select, import or customise a theme | [Using themes](./using.md) |
| Create your first theme | [Writing a theme](./authoring.md) |
| Look up `theme.json` fields and validation | [Theme manifest](./manifest.md) |
| Define palette variables and presets | [Palettes and presets](./palettes.md) |
| Write CSS and recolour YTM | [Styles and recolouring](./styles.md) |
| Add a script, understand consent, or review security | [Theme scripts](./scripts.md) |
| Understand the engine and stored configuration | [Theme engine internals](./internals.md) |
| Run theme tests or debug a problem | [Testing and debugging](./debugging.md) |

## Design in brief

A theme has four parts:

- The **manifest** (`theme.json`) describes the theme and names its files. It is required. A folder with a missing or invalid manifest is skipped.
- **Palette variables** are emitted as `--pear-theme-<key>` CSS custom properties and can be edited by users under **Colors**. A palette is only a bag of variables; it does not recolour anything by itself.
- **CSS** consumes the palette variables and targets YTM's elements and custom properties. One or more stylesheets can be declared and are concatenated in order. Basic's stylesheet is the reference recolour.
- **Scripts** are optional and run in the YTM page. They are not sandboxed and require explicit consent pinned to the script's exact contents.

The engine lives in `apps/desktop/src/main/themes.ts` and `apps/desktop/src/main/theme-load.ts`, the shared types in `packages/sdk/src/themes.ts`, and the page side in `packages/page/src/themes.ts`. The settings card is `packages/ui/src/settings/themes.tsx`.
