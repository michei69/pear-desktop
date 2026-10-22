# Testing and debugging themes

## Tests

The theme engine is covered by three tests beside the app's other cross-cutting tests:

| Test file | Covers |
| --- | --- |
| `tests/themes-load.test.ts` | Folder reading, name fallback, CSS concatenation order, skipped folders and manifests, missing CSS files, folder-name ordering, and absent versus empty palette. |
| `tests/themes-manifest.test.ts` | Manifest validation, `paletteToCss()` output, palette resolution, Default and preset resolution, and `normalizeThemeState()` defaults. |
| `tests/themes-consent.test.ts` | Script reading and hashing, missing script fallback, hash changes only with the script contents, and consent matching. |

Run them with the repository's Playwright-based Node runner (`pnpm test`). See [Tests](../conventions.md#tests) for the general test conventions. The tests use temporary directories and never touch the real themes folder.

## Iterating on a theme

1. Add or edit the folder's files. There is no file watcher: the folders are re-read at startup and on each theme refresh, which happens when selecting a theme, changing a preset or colour, or importing a stylesheet. Restart the app after editing an already-selected theme to be certain the new files are loaded.
2. A newly added folder appears in **Settings ▸ Appearance ▸ Theme** when the settings UI next reads the list. The native Options menu is built at startup and after in-app imports, so restart to see a hand-made folder there.
3. A theme whose manifest is invalid, or whose CSS or JS files are missing, logs a warning with a `[themes]` prefix. The renderer console also reports evaluation and lifecycle errors from scripts.

## Common symptoms

| Symptom | Likely cause |
| --- | --- |
| The theme does not appear in any list | `theme.json` failed validation, the folder is not directly inside the themes directory, or the menu has not been rebuilt. |
| The theme applies but nothing changes | No `css` is declared, or the CSS does not consume the palette variables. A palette alone recolours nothing. |
| The Colors editor is missing | The resolved palette is empty: no `palette`, no preset values and no user edits. |
| A script never runs | Consent has not been given for the current hash, the `js` file is missing, or evaluation or `mount` threw. Check the console. |
| The consent dialog reappears every start | The script file's bytes change between launches, for example because a file is regenerated or line endings change. |

## Debugging checklist

- Confirm the theme folder is a direct child of `<userData>/themes`.
- Open the folder from the app to confirm you are editing the same directory.
- Validate `theme.json` as plain JSON. Comments make it invalid.
- Check that `css` and `js` paths are joined to the theme folder and that the files are readable.
- Inspect the console for `[themes]` warnings about invalid manifests, unreadable CSS, missing scripts or script errors.
- For a palette problem, confirm that the variable appears under **Colors** and that your CSS uses the matching `--pear-theme-*` name.
- For a script problem, confirm that the manifest declares `js`, that the file has not changed since consent was granted, and that `module.exports` provides the expected hooks.
