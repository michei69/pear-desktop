# Themes

Themes are external folders which are read by the app at startup
from `<userData>/themes`, which you can open from **Options ▸ Visual Tweaks ▸
Theme ▸ Open themes folder**.

```
themes/
  my-theme/
    theme.json      required
    style.css       optional, named by theme.json
    theme.js        optional, named by theme.json
```

The **folder name is the theme id**. A folder with a valid `theme.json` shows up
in the menu and works without a restart.

## Quick start

> [!TIP]
> Have a CSS file theme already? You can import it from **Options ▸ Visual Tweaks ▸ Theme ▸ Import custom CSS file**
> This will automatically generate a theme folder for you, ready to be used again!

The palette is only a bag of variables; the recolouring itself is CSS. So the
quickest recolouring theme is a copy of the **Basic** theme's two files with
your own colours in the palette: its `theme.json`, and the `style.css` that
does the recolouring per [Recolouring YouTube Music](#recolouring-youtube-music).

```json
// themes/solarized/theme.json
{
  "name": "Solarized",
  "palette": {
    "accent": "#b58900",
    "background": "#002b36",
    "surface": "#073642",
    "text": "#93a1a1"
  },
  "css": "style.css"
}
```

A palette is optional: with no keys to expose, a theme is just CSS.

```json
// themes/rounded/theme.json
{ "name": "Rounded", "css": "style.css" }
```

```css
/* themes/rounded/style.css */
body ytmusic-player-bar {
  border-radius: 12px;
}
```

Add a `js` file only when you need to do something CSS cannot, like toggling a
class on `body`. See [Scripts](#scripts).

## theme.json

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
  "css": ["reset.css", "style.css"],
  "js": "theme.js"
}
```

| field         | notes                                  |
| ------------- | -------------------------------------- |
| `name`        | defaults to the folder name            |
| `description` | shown as the menu item tooltip         |
| `author`      | metadata only                          |
| `palette`     | see [Variables](#variables)            |
| `css`         | one or more css files applied in order |
| `js`          | a single path, see [Scripts](#scripts) |

All paths are relative to the theme folder. A theme missing a `css`/`js` file
it names still loads; that file is just skipped with a warning. A folder with an
invalid `theme.json` is skipped entirely with a warning in the console.

## Variables

Customizable options given to the user. Compared to standard css variables, those ones can be easily modifiable by the user without any experience.

### The palette you define

Every `palette` entry becomes a `--pear-theme-<key>` custom property, and values
can be **any CSS value**:

```json
{ "palette": { "accent": "#22c55e", "font": "monospace", "radius": "8px" } }
```

```css
/* consumed by your own CSS */
body ytmusic-player-bar {
  font-family: var(--pear-theme-font);
  border-radius: var(--pear-theme-radius);
}
```

Every variable will appear under **Colors** for the user to easily modify it.

The palette is emitted _after_ your stylesheet, so a key it defines beats the
same variable set in your CSS - which is what makes user overrides and the
fallbacks below work.

### Recolouring YouTube Music

YouTube Music is not recoloured for you - a palette only defines variables. The
Basic theme ships the recolour as an ordinary stylesheet: copy its `style.css`
into your theme folder (open it from **Theme ▸ Open themes folder**) and edit
from there. It re-points these YouTube Music variables at your four roles:

```css
/* background */
--ytmusic-color-black3
--ytmusic-color-black4
--ytmusic-color-blackpure
--yt-spec-base-background
--yt-spec-black-pure
--yt-spec-black-1-alpha-98
--yt-spec-general-background-b
--yt-spec-general-background-c
--yt-spec-snackbar-background
--yt-spec-static-overlay-background-solid
--ytmusic-search-background
--ytmusic-background

/* surface */
--ytmusic-color-black1
--ytmusic-color-black2
--yt-spec-raised-background
--yt-spec-menu-background
--yt-sys-color-baseline--menu-background
--yt-spec-general-background-a
--dark-theme-background-color
--yt-spec-filled-button-text
--yt-spec-static-brand-black
--paper-toast-background-color
--paper-dialog-background-color

/* text */
--yt-spec-text-primary
--yt-spec-text-secondary
--ytmusic-text-primary
--yt-sys-color-baseline--text-primary
--ytmusic-overlay-text-secondary
--ytmusic-icon-inactive

/* accent */
--paper-progress-active-color
--paper-progress-active-color-1
--paper-progress-active-color-2
--paper-slider-knob-color
--paper-slider-knob-start-color
--paper-toggle-button-checked-bar-color
--primary-color
--icon-color
--yt-sys-color-baseline--call-to-action
```

It also sets `background` on `:root`, `background-color` on `ytmusic-dialog`,
`color` on `ytmusic-app-layout`, `.title.ytmusic-player-bar` and
`.time-info.ytmusic-player-bar`, and `color` on
`.summary.ytmusic-setting-boolean-renderer`.

Where YouTube Music wants a shade the palette does not have, the stylesheet
derives one (these are readable from your own CSS too):

| variable                    | value               |
| --------------------------- | ------------------- |
| `--pear-theme-accent-light` | `accent`, lightened |
| `--pear-theme-text-dim`     | `text`, darkened    |

`--ytmusic-overlay-text-secondary` is `text` at 70% opacity,
`--paper-toggle-button-checked-bar-color` uses the lightened accent, and
`--ytmusic-icon-inactive` the darkened text. Either derived name can be set in
your `palette` to override the derived value.

## Styles

`css` may name one or several files; they are concatenated and injected in order
while the theme is selected, and removed when the user switches away.

```json
{ "name": "My Theme", "css": ["reset.css", "layout.css"] }
```

Because it is injected as a plain `<style>`, `@import` and `url()` work as
usual. Target YouTube Music elements directly (`ytmusic-app-layout`,
`ytmusic-player-bar`, `ytmusic-guide-renderer`, ...). The palette variables are
available per the table above; recolouring YouTube Music is your stylesheet's
job, see [Recolouring](#recolouring-youtube-music).

## Scripts

A theme may include a script for what CSS cannot do - toggling a class on
`body`, observing the DOM, or reacting to player state:

```json
{ "name": "My Theme", "palette": { "accent": "#22c55e" }, "js": "theme.js" }
```

```js
// theme.js
module.exports = {
  // Runs when the theme is applied. Return a cleanup function to undo
  // whatever you did.
  mount(context) {
    document.body.classList.add('my-theme');
    return () => document.body.classList.remove('my-theme');
  },
  // Optional; runs after the cleanup function above.
  unmount() {},
};
```

`mount` receives a `context`:

- `context.id` — the theme id
- `context.palette` — the effective palette (theme values plus user overrides)
- `context.applyPalette(partial)` — re-emit palette variables, e.g. to recolour
  from something you read off the page:

  ```js
  mount(context) {
    const cover = document.querySelector('img.thumbnail')?.src;
    if (cover) context.applyPalette({ background: '#101014' });
  }
  ```

The script is evaluated with a CommonJS-style `module`/`exports`, so
`module.exports = { ... }` is the supported shape. It runs only while the theme
is selected, and its cleanup runs when you switch away.

`mount` is called when the theme is applied, **not** on every palette change —
editing a colour under **Colors** does not remount the theme, so DOM work set up
in `mount` survives a recolour. The script runs in the YouTube Music window, so
the DOM is available; but do not touch the DOM at the top level of the file, as
that runs before `mount` is called.

### Consent

**A theme script is not sandboxed.** It runs in the YouTube Music window with
the same level of access as a plugin - it can read and change your settings, send
app messages, and make network requests. Treat installing a theme with a `js`
file exactly like running someone else's code.

Because of that, the app asks for confirmation the first time you select a theme
that contains a script, and the permission is pinned to that script's contents.
Editing the JS file prompts for consent again; editing CSS or `theme.json` does not, since neither
can execute. The script is withheld
from the renderer entirely until you agree.

To withdraw consent, delete the theme's folder; its consent is forgotten on the
next start.

## Colors

**Theme ▸ Colors ▸ \<theme\>** edits any key in that theme's palette, plus
**Reset colors** to drop the overrides for it. Picked values are stored in
config as overrides per theme, so a theme's own `theme.json` is never modified
and your tweaks survive a theme update.

## Adding and removing

Create a folder to add a theme; delete the folder to remove one. There is no option to remove themes from the app itself.

Removal is picked up on restart, along with any leftover palette overrides and
script consent for that theme, which are discarded. Until you restart, a deleted
theme keeps working from its already-loaded copy.

## Built-in theme

The first launch seeds a **Basic** theme: a four-colour palette plus the
recolouring stylesheet described above, so it is both the default look and the
reference for writing your own. It is an ordinary theme folder - edit it, copy
it as a starting point, or delete it. If you delete it, it stays deleted; the
app will not re-create it.
