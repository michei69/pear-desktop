# Styles and recolouring

A theme's CSS does the visible work. The palette only exposes variables; the stylesheet decides which YouTube Music elements and custom properties consume them.

## Declaring stylesheets

`css` may name one file or several. They are concatenated and injected in the declared order while the theme is selected, and removed when the user switches away.

```json
{ "name": "My Theme", "css": ["reset.css", "layout.css"] }
```

Because the result is injected as a plain `<style>` element, `@import` and `url()` work as usual. Relative URLs are resolved against the page rather than the theme folder, so prefer absolute URLs or embed the needed data.

Target YouTube Music elements directly, for example `ytmusic-app-layout`, `ytmusic-player-bar` and `ytmusic-guide-renderer`. The palette variables are available as described in [Palettes and presets](./palettes.md), and recolouring YouTube Music is your stylesheet's job.

Multiple files are concatenated with a newline and applied together. A missing or unreadable declared file is dropped with a `[themes] could not read <path>, skipping` warning; the remaining files still load. See [Validation and loading](./manifest.md#validation-and-loading).

## Recolouring YouTube Music

The engine does not recolour anything for you. The Basic theme ships the recolour as an ordinary `style.css`, and that file is the recipe to copy. Open **Options ▸ Visual Tweaks ▸ Theme ▸ Open themes folder**, copy `basic/style.css` into your theme folder and edit it, or declare your own rules.

Basic maps YouTube Music's CSS variables onto its four roles:

| Role | YouTube Music variable |
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
| `text` | `--ytmusic-icon-inactive` (via `--pear-theme-text-dim`) |
| `accent` | `--paper-progress-active-color` |
| `accent` | `--yt-sys-color-baseline--call-to-action` |
| `accent` | `--icon-color` |
| `accent` | `--paper-toggle-button-checked-bar-color` (via `--pear-theme-accent-light`) |
| `accent` | `--primary-color` |
| `accent` | `--paper-progress-active-color-1` |
| `accent` | `--paper-progress-active-color-2` |
| `accent` | `--paper-slider-knob-color` |
| `accent` | `--paper-slider-knob-start-color` |

It also styles a few elements and their descendants directly:

| Selector | Property | Value |
| --- | --- | --- |
| `:root` | `background` | `--pear-theme-background` |
| `ytmusic-dialog` | `background-color` | `--pear-theme-surface` |
| `ytmusic-app-layout` | `color` | `--pear-theme-text` |
| `.title.ytmusic-player-bar` | `color` | `--pear-theme-text` |
| `.time-info.ytmusic-player-bar`, `.summary.ytmusic-setting-boolean-renderer` | `color` | `--pear-theme-text-dim` |
| `.background-gradient.style-scope`, `ytmusic-app-layout[is-bauhaus-sidenav-enabled] #mini-guide-background.ytmusic-app-layout` | `background` | `--ytmusic-background` |
| `#progress-bar.ytmusic-player-bar`, `.seekbar-theme #progress-bar.ytmusic-player-bar` | `--paper-progress-active-color-1`, `--paper-progress-active-color-2`, `--paper-slider-knob-color`, `--paper-slider-knob-start-color` | `--pear-theme-accent` |

The declarations that repoint YouTube Music's variables, and the element rules, use `!important` because YouTube Music sets the same properties itself. The list is what Basic covers, not every variable YouTube Music exposes. Add your own rules for surfaces it misses and target the page's elements directly.

## Derived values

Where YouTube Music wants a shade that the four roles do not carry, Basic derives one. These are ordinary custom properties readable from your own CSS, but they are **not emitted by the engine**. They are declared in Basic's stylesheet, so a theme with its own `style.css` has to define them, or copy Basic's rules, if it wants them:

| Variable | Definition | Used for |
| --- | --- | --- |
| `--pear-theme-accent-light` | `color-mix(in srgb, var(--pear-theme-accent) 65%, white)` | checked toggle bar |
| `--pear-theme-text-dim` | `color-mix(in srgb, var(--pear-theme-text) 70%, black)` | inactive icons, player time, settings summary |

`--ytmusic-overlay-text-secondary` is text at 70% opacity, `--paper-toggle-button-checked-bar-color` uses the lightened accent and `--ytmusic-icon-inactive` uses the darkened text. Palette keys are prefixed with `--pear-theme-`, so a palette entry named `accent-light` or `text-dim` produces `--pear-theme-accent-light` or `--pear-theme-text-dim` and overrides the stylesheet's derived value because the palette is injected after the theme CSS.

## Styling tips

- Use palette variables in your own rules rather than repeating colour literals.
- Prefer YouTube Music's existing custom properties where possible so the theme follows the page's own layout.
- Include `!important` when YouTube Music sets the same property itself, as Basic does for its variable mapping.
- Remember that a palette change does not remount a theme script. DOM state created by `mount` survives a recolour, but stylesheet rules still apply immediately.
- Use the browser console and the `[themes]` warnings described in [Testing and debugging](./debugging.md) when a rule or file is not taking effect.
