# Pear Desktop documentation

These pages describe how the merged Pear Desktop is built and how to extend it. They are for contributors and for anyone writing a plugin or a theme.

The code is the source of truth. Every claim here should be checkable against the file named next to it; when a page and the code disagree, the code is right and the page needs a fix.

## Where to start

| If you want to... | Read |
| --- | --- |
| Understand how the app fits together | [Architecture](./architecture.md) |
| Write a plugin | [Plugins overview](./plugins/index.md), then [Creating a plugin](./plugins/creating.md) |
| Change an existing plugin | [Modifying plugins](./plugins/modifying.md) |
| Port a plugin from pear-desktop 3.x | [Porting from upstream](./plugins/porting-from-upstream.md) |
| Use or extend the player integration | [Player API](./plugins/player-api.md) |
| Use a theme | [Themes overview](./themes/index.md), then [Using themes](./themes/using.md) |
| Write a theme | [Writing a theme](./themes/authoring.md), then [Theme manifest](./themes/manifest.md) |
| Debug a theme | [Testing and debugging](./themes/debugging.md) |
| Contribute code, tests, translations or releases | [Conventions](./conventions.md) |
| Install or run the app | [Repository README](../README.md) |

## All pages

| Page | Covers |
| --- | --- |
| [Architecture](./architecture.md) | Process model, boot, build, config, plugins, player, settings, API, links, performance |
| [Conventions](./conventions.md) | Commits, layout, style, translations, tests, releases |
| [Plugins](./plugins/index.md) | Discovery, definition, lifecycle, contexts, config, communication, RPC |
| [Creating a plugin](./plugins/creating.md) | Walkthrough from scaffold to tests |
| [Modifying plugins](./plugins/modifying.md) | Options, commands, actions, menus, migrations |
| [Player API](./plugins/player-api.md) | NowPlaying, actions, queue helpers, song details, audio graph |
| [Using plugins](./plugins/using.md) | Enabling, settings, config file, errors, restarts |
| [Porting from upstream](./plugins/porting-from-upstream.md) | Mapping pear-desktop 3.x plugins onto this tree |
| [Themes](./themes/index.md) | Folder themes and the documentation map |
| [Using themes](./themes/using.md) | Selecting, importing, palettes, consent, Basic theme |
| [Writing a theme](./themes/authoring.md) | Folder layout and quick start |
| [Theme manifest](./themes/manifest.md) | `theme.json` fields, validation and loading |
| [Palettes and presets](./themes/palettes.md) | Variables, presets, resolution and stored picks |
| [Styles and recolouring](./themes/styles.md) | CSS loading, Basic's variable mapping, derived values |
| [Theme scripts](./themes/scripts.md) | Script contract, consent and security |
| [Theme engine internals](./themes/internals.md) | Engine flow, host methods, config keys, pruning |
| [Testing and debugging themes](./themes/debugging.md) | Theme tests, warnings and symptoms |

## The repository at a glance

| Path | What lives there |
| --- | --- |
| `apps/desktop/src/main/` | Main process: boot, window, menu, config, migrations, themes, API server (v1, v2, WebSocket, MCP), plugin host, language sync, links and permissions |
| `apps/desktop/src/preload/` | Preload bridge and page-runtime injection |
| `apps/desktop/e2e/` | Playwright tests that drive the built app |
| `apps/desktop/test/` | Vitest tests for the desktop app |
| `apps/desktop/electron.vite.config.ts` | electron-vite build, build metadata, plugin options |
| `apps/desktop/electron-builder.yml` | Packaging targets, Flatpak runtime, locale trimming |
| `packages/sdk/src/` | `definePlugin`, config schemas, player types, selectors, queue helpers, RPC, theming types, macros, DOM helpers |
| `packages/page/src/` | YTM page runtime: player facade, plugin runner, themes, appearance, performance mode, share-link cleaning, audio graph, API handlers |
| `packages/ui/src/` | Preact settings dialog, fields, theme card, standalone entry |
| `packages/vite-plugin-pear/src/` | Plugin discovery, host/page splitting, virtual modules, i18n module |
| `plugins/<id>/` | One workspace package per plugin: `index.ts` or `index.tsx`, optional helper modules, `test/` |
| `src/i18n/resources/` | Translation JSON files, one per language |
| `scripts/` | `new-plugin.ts`, `escape-names.ts`, `install-hooks.ts` |
| `docs/` | This documentation |

## Ground rules for these docs

- Describe what the code does today, including the quirks. Do not document a feature because it should exist or existed before the rewrite.
- Link current paths under `apps/desktop`, `packages` and `plugins`; do not use the removed `src/` layout except for `src/i18n/resources`.
- Keep examples close to real code. Plugin APIs come from `@pear/sdk`, never from upstream's `@/utils`.
- Use pnpm and the scripts in the root `package.json`; `pnpm dev`, `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm dist`.
- The root `README.md` is user-facing and maintained separately. It may lag behind this documentation.
- User-facing text needs a translation key. The workflow is in [Conventions](./conventions.md#user-facing-text-and-translations).
