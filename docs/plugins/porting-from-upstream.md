# Porting from upstream

This page maps a pear-desktop 3.x plugin (one folder per plugin in upstream's source tree) onto this tree. The APIs are not source-compatible: upstream plugins import app internals, this tree exposes one SDK with a host and a page part. Use [Plugins overview](./index.md) for the target API.

## File and package layout

| Upstream | Here |
| --- | --- |
| A plugin folder's `index.ts` | `plugins/<id>/index.ts` in a workspace package |
| A single-file plugin beside the folders | Not supported; every plugin is a folder |
| Upstream's shared plugin utilities | `packages/sdk/src/` (`@pear/sdk` and its subpaths) |
| `@/utils`, `@/i18n`, `@/types/*` imports | `@pear/sdk` (or a subpath) and `ctx.t` |
| Upstream's plugin importer | `packages/vite-plugin-pear/src/index.ts` |
| A plugin's `settings.ts` | The `config` schema in `index.ts` or a helper module |
| A plugin's `menu.ts` | `ctx.addMenuItem` calls in `host.start` |
| A plugin's `backend.ts` | The `host` part, or a helper it imports |
| A plugin's `preload.ts` | No equivalent; use `page.runAt: "start"` for early page patches |
| A plugin's `renderer.ts` | The `page` part |
| A plugin's `style.css?inline` | The `style` field with the `css` macro, or `ctx.addStyle` |
| A plugin's test folder | `plugins/<id>/test/` with Vitest |

Create the package with `pnpm exec node scripts/new-plugin.ts <id>`, then `pnpm install`. Package dependencies go into the plugin's own `package.json`; the app imports the plugin from `plugins/<id>/index.ts`.

## Definition fields

| Upstream | Here |
| --- | --- |
| `createPlugin({...})` | `definePlugin({...})` |
| Folder name as id | `id` is explicit and must match the folder |
| `name: () => t(...)` | `name: "Plain English"`; the catalog translates `plugins.<id>.name` |
| `description: () => t(...)` | `description: "Plain English"` |
| `config: { enabled: false, ... }` | `config: { ... }` without `enabled`; the flag is stored separately |
| `config` type extends `PluginConfig` | Infer with `ConfigOf<typeof schema>` or `HostContextOf<typeof schema>` |
| `platform` bitmask | `platforms: ["linux", "win32", "darwin"]` |
| `essential: true` | No equivalent; the plugin is either enabled by default or off |
| `enabledByDefault` | Same name; also accepts a list of platforms |
| `restartNeeded: true` | `restartRequired: true` |
| `addedVersion` / NEW badge | No equivalent |
| `settings: [...]` / `settings: { groups }` | `config` field builders; the settings UI is generated |
| `stylesheets: [cssString]` | `style: css\`...\`` or `style: (config) => ...` |
| `menu: (ctx) => items` | `ctx.addMenuItem({ label, accelerator?, click })` |
| `backend` object | `host` object |
| `preload` object | No equivalent |
| `renderer` object or function | `page` object or function |
| `renderer.onPlayerApiReady(api)` | `await ctx.player.ready()` in `page.start` |
| `renderer.components` | Preact rendered by the plugin, or shared helpers from `@pear/sdk/dom` |

## Lifecycle

| Upstream | Here |
| --- | --- |
| `backend.start(ctx)` | `host.start(ctx)` |
| `backend.stop(ctx)` | Return a cleanup from `start`, or use `ctx.onCleanup` |
| `backend.onConfigChange(config)` | `host.onConfigChange(config, ctx)` or `ctx.onConfigChange` from `start` |
| `renderer.start(ctx)`, `renderer.stop()` | `page.start(ctx)`, return a cleanup |
| `renderer.onConfigChange(config)` | `page.onConfigChange(config, ctx)` or `ctx.onConfigChange` |
| `this` on methods, fields for state | `this` in commands only; `start` closures hold page state |
| `ipc.send` / `ipc.invoke` from the page | `ctx.host.invoke(command, ...args)` |
| `ipc.handle` / `ipc.on` in the backend | `host.commands`, or `ctx.host.handle` on the page |
| `peard:*` custom IPC channels | Not needed inside a plugin; use commands, events and requests |

There is no direct `ipcMain`/`ipcRenderer` access for plugins. Do not import Electron in a page part: it does not exist there. A host part may import Electron and Node.

## Config and settings

Upstream's `settings` array had types such as `switch`, `select`, `slider`, `text`, `multiselect`, `orderable`, `action` and `custom`. In this tree:

| Upstream setting | Here |
| --- | --- |
| `switch` | `config.bool(default, { label })` |
| `slider` / `number` | `config.number(default, { min, max, step, unit, variant })` |
| `text` | `config.string(default, { placeholder, secret })` |
| `select` | `config.select(default, options, { label })` |
| `multiselect` | `config.multi(default, options, { label })` |
| `orderable` | Not supported |
| `action` buttons | `actions` plus `host.commands` |
| Custom components | Preact in the plugin's own UI, not in the settings card |
| `visible` conditions | Not supported; show or hide in page UI instead |
| `languageSync` | No equivalent |
| Dotted setting keys | Fields are a flat schema; nest with `group` headings |

The settings card is generated from `config`, so there is no separate settings editor to port. Field texts are translated through `plugins.<id>.settings.<field>.*`; run `pnpm i18n`.

Stored config is still `plugins.<id>` with the old option names where they still mean the same. Upstream stored only values that differed from defaults and deep-merged on read. This tree normalizes the stored object against the schema on read, keeps unknown keys, and never writes defaults into the file. A ported plugin can usually keep its stored options; the `4.0.0` migration in `apps/desktop/src/main/migrations/plugins.ts` already converts the plugins that ship here. A ported third-party plugin needs its own migration only if it renames or reshapes options.

## Page and player APIs

Upstream renderer code reached into `document`, `#movie_player`, IPC and app internals. This tree provides:

- `ctx.player` instead of caching the player element or wiring `song-info` callbacks.
- `ctx.$`, `ctx.$$`, `ctx.waitFor`, `ctx.mount`, `ctx.observe` and selector names instead of CSS class selectors.
- `ctx.listen`, `ctx.setTimeout` and `ctx.setInterval` instead of raw DOM and timer APIs.
- `ctx.audio()` instead of connecting the `<video>` to a new `AudioContext`.
- `ctx.addStyle` or `style` instead of injecting `<style>` elements.
- `ctx.toast` instead of YTM's internal toast API.
- `@pear/sdk/queue` instead of reaching into the queue element.
- `@pear/sdk/dom` pickers, popovers, sidebar entries and popup menu items instead of copying the app's DOM code.

The page part is not preloaded before the page. For work that must precede YTM's scripts, use `page: { runAt: "start", start(ctx) { ... } }`; it runs in the page's main world. Anything that needs DOM readiness uses the default `runAt: "idle"` and `ctx.waitFor`.

`onPlayerApiReady` is gone. If a plugin needs YTM's raw API before doing anything, await `ctx.player.ready()` inside `start`. If it can start earlier, subscribe to `ctx.player` events first.

## Menus and native UI

Upstream's `menu` half returned Electron menu items, including submenus and radio groups. This tree supports one flat item per plugin in the app and tray menus:

```ts
host: {
  start(ctx) {
    ctx.addMenuItem({ label: "Show my plugin", click: () => ctx.focusWindow() });
  },
},
```

Menus that need dynamic radio groups (quality, speed, captions) are now page pickers on the player bar. See `plugins/quality-changer`, `plugins/playback-speed` and `plugins/captions-selector`.

## Translations

Upstream's plugin `name` and `description` were functions returning `t(...)`, and settings labels were functions. Here they are plain strings; the catalog translates them from `plugins.<id>.*`. Visible text created at runtime uses `ctx.t(key, english, vars)`. Run `pnpm i18n`; keys found by the generator are literal `t("key", "English")` calls in the source.

## Things that no longer exist

- The per-process plugin loaders (main, preload, renderer, menu), their loaded-plugin maps and their IPC channels.
- The `settings-ui` plugin and its modal protocol. Settings are core now.
- The `api-server` plugin. The API server is a core section, stored at `plugins.api-server`, with v1 routes and plugin RPC.
- The `memory-saver` and `performance-improvement` scripts are plugins, not core providers. The old app-level performance mode is not in this tree.
- The old app-internal config, provider, theme and type modules as plugin-visible imports. The SDK owns the shared surface.
- Direct `peard:*` IPC and `electron-store`.

## Porting checklist

1. Create the workspace package and move the entry to `plugins/<id>/index.ts`.
2. Convert the definition to `definePlugin`, with an explicit id and plain strings.
3. Convert settings to a `config` schema; move buttons to `actions` and host commands.
4. Split behavior into `host` and `page`; move Electron, Node and filesystem code to `host`.
5. Replace app internals and IPC with SDK APIs and `ctx` members.
6. Replace class selectors with names from `packages/sdk/src/selectors.ts`, adding missing names there.
7. Move timers, listeners, observers and styles to `ctx`; return cleanups or use `ctx.onCleanup`.
8. Mark `restartRequired` for global patches; move early page patches to `runAt: "start"`.
9. Convert visible strings to schema texts and `ctx.t`, then run `pnpm i18n`.
10. Add Vitest tests and an e2e test when the behavior is observable in the app.
11. Run `pnpm typecheck`, `pnpm lint`, `pnpm format` and `pnpm test`.
