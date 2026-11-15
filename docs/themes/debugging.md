# Testing and debugging themes

## Tests

Theme behavior is tested with Vitest. The desktop engine tests live in `apps/desktop/test/`; pure helper tests for manifest parsing and palette resolution belong in `packages/sdk/test/`, beside the code they cover in `packages/sdk/src/themes.ts`.

Run them with:

```sh
nub run test
```

The tests use temporary directories and never touch the real themes folder. See [Conventions](../conventions.md#tests) for the general test rules.

## Iterating on a theme

1. Edit the folder's files. The host polls the folders every second, so a saved CSS, palette or manifest change applies without restarting. A changed script needs consent again before it runs.
2. A newly added folder appears in Settings and the page on the next poll. The native menu updates on its next rebuild or at the next start.
3. Invalid manifests, unreadable CSS and missing scripts log a warning with a `[themes]` prefix. Script evaluation and lifecycle errors are logged in the page console.
4. Use **Options ▸ Toggle DevTools** to inspect the page, the adopted style sheets and the `--pear-theme-*` properties.

## Common symptoms

| Symptom | Likely cause |
| --- | --- |
| The theme does not appear in any list | `theme.json` failed validation, the folder is not directly inside the themes directory, or the file is unreadable. |
| The theme appears in Settings but not in the native menu | The menu was built before the folder was added; restart or make the app rebuild it. |
| The theme applies but nothing changes | No `css` is declared, or the CSS does not consume the palette variables. A palette alone recolours nothing. |
| The Colors editor is missing | The resolved palette is empty: no `palette`, no preset values and no user edits. |
| A script never runs | Consent has not been given for the current hash, the `js` file is missing, or evaluation or `mount` threw. Check the console and the **Allow** button on the Theme card. |
| The consent dialog reappears every start | The script file's bytes change between launches, for example because a file is regenerated or line endings change. |
| A script change does nothing after editing | The hash changed, so the script is blocked. Allow it from the Theme card. |

## Debugging checklist

- Confirm the theme folder is a direct child of `<userData>/themes` and open it from the app to be sure you are editing the same directory.
- Validate `theme.json` as plain JSON. Comments make it invalid.
- Check that `css` and `js` paths resolve inside the folder and that the files are readable.
- Inspect the console for `[themes]` warnings about invalid manifests, unreadable CSS, missing scripts or script errors.
- For a palette problem, confirm that the variable appears under **Colors** and that your CSS uses the matching `--pear-theme-*` name.
- For a script problem, confirm the manifest declares `js`, the file has not changed since consent, and `module.exports` provides `mount` or `unmount`.
- If a rule loses to another theme rule, remember that the theme's CSS is applied after plugin CSS and before the palette; use a more specific selector or `!important` where YTM sets the same property.
