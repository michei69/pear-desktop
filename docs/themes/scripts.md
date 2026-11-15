# Theme scripts

A theme script handles work CSS cannot do: toggling classes on `body`, observing the DOM or reacting to page state. Scripts are powerful and are not sandboxed. Read [Security](#security) before installing or distributing one.

## Declaring a script

Declare the single script path in `theme.json`:

```json
{ "name": "My Theme", "palette": { "accent": "#22c55e" }, "js": "theme.js" }
```

A script must be declared rather than auto-discovered because consent is pinned to the exact source. A missing declared script only removes the script from the loaded theme; the CSS still applies. See [Optional and absent fields](./manifest.md#optional-and-absent-fields).

## Example

```js
// theme.js
module.exports = {
  // Runs when the theme is applied. Return a cleanup function to undo
  // whatever you did.
  mount(context) {
    document.documentElement.classList.add('my-theme');
    return () => document.documentElement.classList.remove('my-theme');
  },
  // Optional; runs after the cleanup function above.
  unmount() {},
};
```

The folder is not bundled or transpiled.

## Evaluation

`packages/page/src/themes.ts` evaluates the source as `new Function('module', 'exports', source)(module, module.exports)`.

- The supported export shape is `module.exports = { ... }`. The `exports` parameter initially aliases the same object, so assigning properties such as `exports.mount` also works, but reassigning `exports` does not. Use `module.exports`.
- `export default` is not provided. ESM syntax does not run; the reader passes only `module` and `exports`.
- `import` and `require` are not provided.
- The module body runs first, then `mount` is called immediately. Put DOM work in `mount` so it can be paired with cleanup. Top-level work has no matching teardown.
- At startup the theme is applied before DOM ready, so `document.body` may not exist when `mount` runs. Attach to `document.documentElement`, or wait for the element you need before touching it.
- Only the selected theme's script runs, and only when the user consented to its current hash.
- Errors from evaluation, `mount`, cleanup and `unmount` are caught and logged with `[themes]` prefixes. They do not roll back the theme's CSS.

## Script contract

The script is CommonJS and assigns its hooks to `module.exports`. `mount(context)` receives:

| Property | Type | Meaning |
| --- | --- | --- |
| `context.id` | `string` | The theme id, which is the folder name. |
| `context.palette` | `Record<string, string>` | The effective palette: theme palette plus the active preset or user edits. |
| `context.applyPalette` | `(partial: Record<string, string>) => void` | Merges values over the mount-time palette and emits another palette sheet. |

`mount` may return a cleanup function, and `unmount` is optional. When the theme is replaced, the cleanup runs first and `unmount` second.

### `applyPalette`

`applyPalette` merges over the palette captured at mount time and appends a sheet after the theme's palette. On a same-theme refresh, such as a preset switch or colour edit, `mount` does not run again and the sheets a script already added stay until the theme changes or the script is torn down. Use `applyPalette` for colour driven by page state, not for values the user should keep.

```js
mount(context) {
  const cover = document.querySelector('img.thumbnail')?.src;
  if (cover) context.applyPalette({ background: '#101014' });
}
```

## Lifecycle

- `mount` does not re-run when the palette, a preset or a custom colour changes. CSS-only recolours are handled by palette emission, so DOM work from `mount` survives.
- The script is torn down when the theme changes, when the selection is cleared, when the script's source hash changes, or when the script stops being available (the host withholds it and marks the theme `jsBlocked`).
- A changed source is mounted again only after the user allows it. The Theme card shows an **Allow** button while a script is blocked.
- Theme scripts share the page with the app's preload bridge and plugin code. They are not sandboxed.

## Consent

Theme scripts require explicit consent because they run arbitrary code in the YTM page.

1. The first time the user selects a theme whose script is new or changed since they last allowed it, the app shows a warning dialog titled **Run theme code?** with the theme's name and an explanation that the code will run with full access to the app. **Cancel** is the default button.
2. Allowing records the SHA-256 hash of the script file's contents in `options.themeConsent`, keyed by theme id. Consent is pinned to that exact source. Editing `theme.js` changes the hash, so the changed script is withheld until the user selects the theme again or allows it from the Theme card.
3. Until the hash matches, the host withholds the script from the page entirely (`Themes.state()` replaces it with `jsBlocked: true`). The theme's CSS and palette still apply; only the script is absent.
4. Editing CSS or non-script manifest metadata does not re-prompt, because neither can execute. Changing the `js` path can select a different script, so it prompts for consent to the new source.
5. At startup the app checks the selected theme's script and prompts when it is new or changed. Declining leaves the theme selected but without its script; its CSS still applies.

Selecting a theme with a new script and declining the dialog leaves the previous selection in place. The host reads theme folders every second; an edited script changes the state, so the running page drops the script at the next check.

To withdraw consent, delete the theme's folder. Its consent entry is pruned when the folder list is re-read. Replacing `theme.js` with different code also takes effect as a withdrawal: the recorded hash no longer matches, so the script does not run until the user allows the new source.

The hash is computed by `hashThemeJs()` in `apps/desktop/src/main/theme-load.ts`. Consent matching is `isJsConsented()`. The user-facing flow is in [Using themes](./using.md#scripts-and-consent).

## Security

Theme scripts are unsandboxed. A script runs in the YTM page with the same access as a plugin's page part: it can read and change the app's settings through the preload bridge, send messages to the app, make network requests and modify the page. The consent dialog is the only gate, and it is pinned to the exact script source. There is no sandbox, capability list or permission model beyond that.

For the host-side view of consent, withholding and pruning, see [Theme engine internals](./internals.md). For what the same page access means for plugins, see [Plugins](../plugins/index.md).
