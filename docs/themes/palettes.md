# Palettes and presets

Palettes expose theme values as CSS custom properties that users can edit under **Colors**. Presets are named alternate palettes layered over the theme's own palette. Neither feature recolours YouTube Music by itself: your stylesheet must consume the variables. See [Styles and recolouring](./styles.md).

## Palette variables

Every `palette` entry becomes a `--pear-theme-<key>` custom property. The palette is emitted for the selected theme as a single `:root` block:

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
/* consumed by your own CSS */
body ytmusic-player-bar {
  font-family: var(--pear-theme-font);
  border-radius: var(--pear-theme-radius);
}
```

Rules that matter:

- Values are emitted verbatim, so any CSS value works: colours, fonts, lengths and shadows. The engine does not parse or validate the values.
- Keys become part of the property name verbatim. Use lower-case kebab-case such as `scrollbar-width`. The Settings editor displays keys title-cased, splitting on `-`, `_` and whitespace.
- The palette is injected **after** the theme's CSS. A key that the palette defines therefore beats the same `--pear-theme-<key>` declared in your stylesheet. This is what lets user edits override the theme's values and lets a palette entry replace a derived variable such as `--pear-theme-accent-light`.
- The engine emits only the selected theme's palette. Other themes' palettes are not global.
- Users edit every key under **Settings ▸ Appearance ▸ Theme ▸ Colors**, and they may add keys the manifest never defined. Those edits live in config (`options.themeOverrides`), not in your folder, and the palette block is rebuilt from them on each apply.
- Every variable appears under **Colors** for the user to modify. The editor is hidden when the resolved palette contains no variables at all, as with a CSS-only import or a theme whose manifest declares neither `palette` nor non-empty presets.

Palette entries can also override the Basic theme's derived variables. A palette key such as `accent-light` produces `--pear-theme-accent-light`, which replaces the value Basic derives in its stylesheet. The Basic theme defines the derived names, not the engine; see [Derived values](./styles.md#derived-values).

## Presets

`presets` is an object of named palettes. Each preset is layered over the theme's own `palette`, so it only has to list what it changes, and it may introduce keys the palette never defined. Preset values are emitted as the same `--pear-theme-<key>` custom properties, so no CSS has to know whether a value came from the palette or a preset.

```json
{
  "palette": { "accent": "#ff0000", "background": "#030303", "text": "#ffffff" },
  "presets": {
    "blue": { "accent": "#0000ff", "background": "#0303aa" },
    "compact": { "radius": "4px" }
  }
}
```

The moment a `theme.json` has at least one preset, the user gets a **Preset** picker under **Theme** in the settings, plus an **Options ▸ Visual Tweaks ▸ Theme ▸ Presets** submenu. Each list offers **Default**, the presets and **Custom** where those states exist.

- A preset key is title-cased for display, so `"high-contrast"` reads as **High Contrast** in both the settings and the menu.
- `custom` is reserved for the palette the user edits themselves. A manifest preset named `custom` would never be applied.
- An empty preset (`{}`) is valid because it layers nothing.
- Presets are listed in manifest key order, which decides which one stands in for a missing Default.
- The user's pick is stored per theme in `options.themePresets`. Editing a colour or adding a variable switches the pick to `custom`, seeded from the preset that was active.
- Switching to another preset keeps the user's custom palette stored. It returns when Custom is selected again and is only deleted by **Reset colors** or removal of the theme folder.

### Picker behavior

- A theme with no `palette` key has no Default to offer. Its first preset stands in for Default and is applied until the user picks another. The picker shows that theme's presets and Custom, without a Default entry.
- An explicit `"palette": {}` is a declaration, not an omission. It still offers Default, and the first preset is reached only by picking it.
- **Default** is the theme's own `palette`. A preset that the theme no longer defines falls back to this state as well.
- **Custom** is the user's own palette. It is only applied while selected. Picking a preset afterwards hides it but does not delete it.
- Editing a value or adding a variable continues from the preset that is selected and switches the pick to **Custom**. A preset therefore doubles as a starting point the user can tweak.

### Resolution

Resolution is implemented by `defaultPreset()` and `presetPalette()` in `src/themes/types.ts`:

| Stored pick | Layer applied over the theme's palette |
| --- | --- |
| a preset name the theme defines | that preset's values |
| a preset name the theme no longer defines | nothing; the theme's palette shows through |
| `custom` | the user's edited palette |
| `''` (Default), or no entry, with a `palette` declared | nothing; Default is the palette as written |
| `''` (Default), or no entry, with no `palette` | the first preset in manifest order |

`resolvePalette()` then merges the resolved layer over the theme's own palette, with the layer winning. When there is no palette at all, the resolved palette can still come from a preset or from user edits.

## Stored values

- `options.themePresets` stores the pick per theme id: a preset name, `custom` or `''` for Default.
- `options.themeOverrides` stores the user's edited palette per theme id.
- `options.themeOverrides` is used only when the stored pick is `custom`. While the user edits, the custom palette is seeded from the active preset, which makes the preset a starting point. The theme folder is never modified by colour editing.

The renderer gets the current layer for each theme from `themePaletteLayers()` in `src/themes/main.ts`, so it can apply a preset or colour change without reloading the folder.

See [Theme engine internals](./internals.md#configuration-keys) for the complete configuration table.
