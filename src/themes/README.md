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

The smallest useful theme is one file. A four-key `palette` on its own
recolours the whole app, because the base stylesheet re-points YouTube Music's
colours at it:

```json
// themes/solarized/theme.json
{
  "name": "Solarized",
  "palette": {
    "accent": "#b58900",
    "background": "#002b36",
    "surface": "#073642",
    "text": "#93a1a1"
  }
}
```

Add a `css` file when you need more than colour:

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

```css
/* themes/solarized/style.css */
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

| field         | notes                                    |
| ------------- | ---------------------------------------- |
| `name`        | defaults to the folder name              |
| `description` | shown as the menu item tooltip           |
| `author`      | metadata only                            |
| `palette`     | see [Variables](#variables)              |
| `css`         | one or more css files applied in order   |
| `js`          | a single path, see [Scripts](#scripts)   |

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

The default variables are the following:

| key          | role in the recolour                   |
| ------------ | -------------------------------------- |
| `accent`     | seekbar progress, slider knobs         |
| `background` | page and app backgrounds               |
| `surface`    | cards, menus, dialogs, raised surfaces |
| `text`       | primary and secondary text             |

Those four are conventions the base stylesheet reads; **any other key** is just
emitted as a variable for your own CSS, and gets its own entry under **Colors**.

### YouTube Music variables you can target

When the theme has a non-empty `palette`, the base stylesheet re-points these
YouTube Music variables at your four roles — so you can also use them directly
in your CSS:

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

/* accent */
--paper-progress-active-color-1
--paper-progress-active-color-2
--paper-slider-knob-color
--paper-slider-knob-start-color
```

The base stylesheet also sets `background` on `:root` and `color` on
`ytmusic-app-layout`.

### A palette opts you into the recolour

The base stylesheet is injected **only** when a theme has a non-empty `palette`.
A theme with no palette is left as pure CSS, which is what you would want for a layout
theme that should not touch the user's colours.

## Styles

`css` may name one or several files; they are concatenated and injected in order
while the theme is selected, and removed when the user switches away.

```json
{ "name": "My Theme", "css": ["reset.css", "layout.css"] }
```

Because it is injected as a plain `<style>`, `@import` and `url()` work as
usual. Target YouTube Music elements directly (`ytmusic-app-layout`,
`ytmusic-player-bar`, `ytmusic-guide-renderer`, ...). The standard YT Music
palette is available per the table above.

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

The first launch seeds a **Basic** theme: a four-colour palette with no CSS or
JS, so it just recolours the app. It is an ordinary theme folder - edit it, copy
it as a starting point for your own, or delete it. If you delete it, it stays
deleted; the app will not re-create it.
