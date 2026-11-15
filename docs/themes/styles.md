# Styles and recolouring

A theme's CSS does the visible work. The palette only exposes variables; the stylesheet decides which YTM elements and custom properties consume them.

## Declaring stylesheets

`css` may name one file or several. They are concatenated in the declared order into one constructed style sheet while the theme is selected, and removed when the user switches away.

```json
{ "name": "My Theme", "css": ["reset.css", "layout.css"] }
```

The CSS is adopted through `document.adoptedStyleSheets`, after plugin sheets and before the palette and theme-script sheets (`packages/sdk/src/stylesheets.ts`). The cascade therefore lets the palette and a theme script override the theme's own rules, while plugins stay underneath.

`@import` and `url()` work as usual in a constructed style sheet, but relative URLs resolve against the page, not the theme folder. Use absolute URLs or embed the needed data.

Target YTM elements directly, for example `ytmusic-app-layout`, `ytmusic-player-bar` and `ytmusic-guide-renderer`. Recolouring YTM is your stylesheet's job; the palette variables are described in [Palettes and presets](./palettes.md).

A missing or unreadable declared file is dropped with a `[themes] could not read <path>, skipping` warning; the remaining files still load. See [Validation and loading](./manifest.md#validation-and-loading).

## Recolouring YTM

The engine does not recolour anything for you. The Basic theme ships the recolour as an ordinary `style.css`, and that file is the recipe to copy. Open **Options ▸ Theme ▸ Open themes folder**, copy `basic/style.css` into your theme folder and edit it, or write your own rules.

Basic maps YTM's CSS variables onto its four roles:

| Role | YTM variable |
| --- | --- |
| `background` | `--ytmusic-color-black3` |
| `background` | `--ytmusic-color-black4` |
| `background` | `--ytmusic-color-blackpure` |
| `background` | `--yt-spec-base-background` |
| `background` | `--yt-spec-general-background-b` |
| `background` | `--yt-spec-general-background-c` |
| `background` | `--yt-spec-snackbar-background` |
| `background` | `--yt-spec-black-pure` |
| `background` | `--yt-spec-black-1-alpha-98` |
| `background` | `--yt-spec-static-overlay-background-solid` |
| `background` | `--ytmusic-search-background` |
| `background` | `--ytmusic-background` |
| `surface` | `--ytmusic-color-black1` |
| `surface` | `--ytmusic-color-black2` |
| `surface` | `--dark-theme-background-color` |
| `surface` | `--yt-spec-raised-background` |
| `surface` | `--yt-spec-menu-background` |
| `surface` | `--yt-sys-color-baseline--menu-background` |
| `surface` | `--yt-spec-general-background-a` |
| `surface` | `--yt-spec-filled-button-text` |
| `surface` | `--yt-spec-static-brand-black` |
| `surface` | `--paper-toast-background-color` |
| `surface` | `--paper-dialog-background-color` |
| `text` | `--yt-spec-text-primary` |
| `text` | `--yt-spec-text-secondary` |
| `text` | `--ytmusic-text-primary` |
| `text` | `--yt-sys-color-baseline--text-primary` |
| `text` | `--ytmusic-overlay-text-secondary` (text at 70% opacity) |
| `text` | `--ytmusic-icon-inactive` (through `--pear-theme-text-dim`) |
| `accent` | `--paper-progress-active-color` |
| `accent` | `--yt-sys-color-baseline--call-to-action` |
| `accent` | `--icon-color` |
| `accent` | `--paper-toggle-button-checked-bar-color` (through `--pear-theme-accent-light`) |
| `accent` | `--primary-color` |
| `accent` | `--paper-progress-active-color-1` |
| `accent` | `--paper-progress-active-color-2` |
| `accent` | `--paper-slider-knob-color` |
| `accent` | `--paper-slider-knob-start-color` |

It also styles a few elements directly:

| Selector | Property | Value |
| --- | --- | --- |
| `:root` | `background` | `--pear-theme-background` |
| `ytmusic-dialog` | `background-color` | `--pear-theme-surface` |
| `ytmusic-app-layout` | `color` | `--pear-theme-text` |
| `.title.ytmusic-player-bar` | `color` | `--pear-theme-text` |
| `.time-info.ytmusic-player-bar`, `.summary.ytmusic-setting-boolean-renderer` | `color` | `--pear-theme-text-dim` |
| `.background-gradient.style-scope`, `ytmusic-app-layout[is-bauhaus-sidenav-enabled] #mini-guide-background.ytmusic-app-layout` | `background` | `--ytmusic-background` |
| `#progress-bar.ytmusic-player-bar`, `.seekbar-theme #progress-bar.ytmusic-player-bar` | `--paper-progress-active-color-1`, `--paper-progress-active-color-2`, `--paper-slider-knob-color`, `--paper-slider-knob-start-color` | `--pear-theme-accent` |

The declarations that repoint YTM's variables and the element rules use `!important` because YTM sets the same properties itself. This list is what Basic covers, not every variable YTM exposes. Add rules for surfaces it misses and target the page's elements directly.

## Derived values

Where YTM wants a shade the four roles do not carry, Basic derives one. These are ordinary custom properties readable from your CSS, but they are not emitted by the engine. They are declared in Basic's `style.css`, so a theme with its own stylesheet must define them or copy Basic's rules if it wants them:

| Variable | Definition | Used for |
| --- | --- | --- |
| `--pear-theme-accent-light` | `color-mix(in srgb, var(--pear-theme-accent) 65%, white)` | checked toggle bar |
| `--pear-theme-text-dim` | `color-mix(in srgb, var(--pear-theme-text) 70%, black)` | inactive icons, player time, settings summary |

A palette key named `accent-light` or `text-dim` produces the same property name and overrides the stylesheet's derived value, because the palette is emitted after the theme CSS.

## Style tips

- Use palette variables in your rules rather than repeating colour literals.
- Prefer YTM's existing custom properties so the theme follows the page's layout.
- Include `!important` when YTM sets the same property itself, as Basic does for its variable mapping.
- A palette change does not remount a theme script. DOM state created by `mount` survives a recolour, while stylesheet rules still apply immediately.
- Use the browser console and the `[themes]` warnings described in [Testing and debugging](./debugging.md) when a rule or file has no effect.
