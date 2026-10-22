# Pear Desktop documentation

These pages describe how Pear Desktop is built and how to extend it. They are meant for contributors and for anyone writing a plugin or a theme, be it humans or AI agents.

The source code is the source of truth. Every claim here should be checkable against the file named next to it; if a page and the code disagree, the code is right and the page needs a fix.

## Where to start

| If you want to...                    | Read                                                              |
| ------------------------------------ | ----------------------------------------------------------------- |
| Understand how the app fits together | [Architecture](./architecture.md)                                 |
| Write a plugin                       | [Plugins overview](./plugins/index.md), then [Creating a plugin](./plugins/creating.md) |
| Change an existing plugin            | [Modifying plugins](./plugins/modifying.md)                       |
| Port a plugin from upstream          | [Porting from upstream](./plugins/porting-from-upstream.md)       |
| Use YouTube Music's player API       | [Player API](./plugins/player-api.md)                             |
| Use a theme                          | [Themes overview](./themes/index.md), then [Using themes](./themes/using.md) |
| Write a theme                        | [Writing a theme](./themes/authoring.md), then [Theme manifest](./themes/manifest.md) |
| Send a patch                         | [Conventions](./conventions.md)                                   |
| Install or run the app               | [Repo README file](../README.md)                                  |

## The repository at a glance

| Path              | What lives there                                                        |
| ----------------- | ----------------------------------------------------------------------- |
| `src/index.ts`    | Electron main process: window, menu, tray, protocol, config wiring      |
| `src/preload.ts`  | Preload bridge; loads i18n and preload plugins, injects the renderer    |
| `src/renderer.ts` | Page-world boot: waits for YouTube Music, starts renderer plugins       |
| `src/loader/`     | Per-process plugin loaders (main, preload, renderer, menu)              |
| `src/plugins/`    | One folder (or one bare `.ts` file) per plugin; its name is the plugin id |
| `src/themes/`     | Folder-based theme engine (main, loader, renderer, manifest types)      |
| `src/config/`     | Defaults, the persistent store, migrations, plugin config helpers       |
| `src/providers/`  | Shared services and IPC glue used by the app and by plugins             |
| `src/i18n/`       | i18next setup and the JSON translation resources                        |
| `src/types/`      | App-wide types, including the player API surface                        |
| `vite-plugins/`   | Build-time generators for `virtual:plugins` and `virtual:i18n`          |
| `tests/`          | Cross-cutting tests, run with Playwright's test runner                  |
| `docs/`           | This documentation                                                      |

## Ground rules for these docs

- Describe what the code does today, including the quirks. Do not document a feature because it 'should' exist.
- Link the code, not the past: prefer `src/...` paths and current file names.
- Keep examples runnable or at least directly adaptable; no pseudo-code where real code is short enough.
- The root `README.md` is user-facing and maintained separately; it is not part of this documentation set and may lag behind the code.
- User-facing changes need translated strings. That rule and the rest of the contribution workflow are in [Conventions](./conventions.md).
