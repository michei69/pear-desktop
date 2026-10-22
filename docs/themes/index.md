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

At most one theme is selected at a time. Selecting a theme applies its CSS and palette; if it has a script and you have allowed it, the script also runs. Selecting **No theme** injects nothing, so YouTube Music looks as it does without the app.

Themes can be used entirely through **Options ▸ Visual Tweaks ▸ Theme** and **Settings ▸ Appearance ▸ Theme**. Theme authors work in the same folder using the manifest, stylesheet and optional script described here.

## Documentation map

| Goal | Read |
| --- | --- |
| Install, select, import or customise a theme | [Using themes](./using.md) |
| Create your first theme | [Writing a theme](./authoring.md) |
| Look up `theme.json` fields and validation | [Theme manifest](./manifest.md) |
| Define palette variables and presets | [Palettes and presets](./palettes.md) |
| Write CSS and recolour YouTube Music | [Styles and recolouring](./styles.md) |
| Add a script, understand consent, or review security | [Theme scripts](./scripts.md) |
| Understand the engine and stored configuration | [Theme engine internals](./internals.md) |
| Run theme tests or debug a problem | [Testing and debugging](./debugging.md) |

## Design in brief

A theme has four parts:

- The **manifest** (`theme.json`) describes the theme and names its files. It is required. A folder with a missing or invalid manifest is skipped.
- **Palette variables** are exposed as `--pear-theme-<key>` CSS custom properties and can be edited by users under **Colors**. A palette is only a bag of variables; it does not recolour anything by itself.
- **CSS** consumes the palette variables and targets YouTube Music's elements and custom properties. The Basic theme's stylesheet is the reference recolour. One or more stylesheets can be concatenated and injected while the theme is selected.
- **Scripts** are optional and run in the YouTube Music window. They are not sandboxed and require explicit consent pinned to the script's exact contents.

The folder layout, file naming and loading rules are covered in [Writing a theme](./authoring.md) and [Theme manifest](./manifest.md). The user interface and stored state are covered in [Using themes](./using.md) and [Theme engine internals](./internals.md).
