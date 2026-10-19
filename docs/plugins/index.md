# Plugins

This page is the reference for the plugin system in this fork of Pear Desktop:
discovery, definition fields, process halves, contexts and loading rules. It is
written for contributors; [Creating a plugin](./creating.md) walks through
writing one, and [Using plugins](./using.md) covers the user-facing side.

Plugins are compiled into the app. The build scans `src/plugins/`, so every
plugin ships inside the bundle; there is no loader for externally installed
plugins, no plugin directory in the user's data folder, and no way to install a
third-party plugin. Adding one means changing source and rebuilding.

## Discovery

`vite-plugins/plugin-importer.mts` scans two patterns under `src/plugins/`:

- `src/plugins/<id>/index.{js,ts,jsx,tsx}` - the usual folder form, for example
  `src/plugins/seek-shortcuts/index.ts`.
- `src/plugins/<id>.{js,ts,jsx,tsx}` - a single-file plugin, for example
  `src/plugins/audio-compressor.ts`.

`src/plugins/utils/**` is excluded, so shared helpers live there without being
treated as plugins. The plugin id is the folder name or the file's basename. The
generated module identifiers are that id in camelCase
(`always-show-volume-slider` becomes `alwaysShowVolumeSliderPlugin`); the id
itself stays kebab-case everywhere the app uses it: menus, config keys, IPC.

Every entry module default-exports `createPlugin({ ... })` from `@/utils`.
`createPlugin` is an identity function that exists for type inference, so the
exported value is the definition object:

```ts
import { t } from '@/i18n';
import { createPlugin } from '@/utils';

export default createPlugin({
  name: () => t('plugins.hello-world.name'),
  description: () => t('plugins.hello-world.description'),
  config: { enabled: false },
  renderer: {
    start() {
      console.log('hello from the renderer');
    },
  },
});
```

`src/plugins/always-show-volume-slider/index.ts` is the smallest real example
of a renderer-only plugin; `src/plugins/ambient-mode/index.ts` shows config,
settings, a menu and a renderer half together, and
`src/plugins/downloader/index.ts` shows the backend, renderer and menu halves
together.

## The plugin definition

`PluginDef` in `src/types/plugins.ts` is the full shape.

| Field | Type | Purpose |
| ----- | ---- | ------- |
| `name` | `() => string` | Required. Shown in the Plugins menu and the settings card. |
| `description` | `() => string` | Tooltip in the menu, description on the settings card. |
| `authors` | `string[]` | Metadata only; the app does not render it today. |
| `addedVersion` | `string` | Semver range (`'3.12.X'`); the menu shows **NEW** while the build version satisfies it. |
| `config` | `Config` | Defaults; must include `enabled`. Omitted config means `{ enabled: false }`. |
| `platform` | `Platform` | Bitmask; the generated plugin maps and the UI leave it out on other platforms. |
| `essential` | `boolean` | Always on, ignores `config.enabled`, no switch on the settings card. |
| `menu` | `(ctx: MenuContext) => MenuItemConstructorOptions[] \| Promise<...>` | Entries under the plugin's submenu in the native Plugins menu. |
| `stylesheets` | `string[]` | CSS text imported with `?inline`; loaded by the renderer loader. |
| `restartNeeded` | `boolean` | Enabling or disabling the plugin requires a restart. |
| `settings` | `SettingsSchema` | Declarative fields rendered by the settings UI; see [Creating a plugin](./creating.md#settings-schema). |
| `backend` | lifecycle or object | Main-process half; see below. |
| `preload` | lifecycle or object | Preload-script half. |
| `renderer` | lifecycle or object | Page-world half; also accepts `onPlayerApiReady` and `components`. |

`name`, `description`, labels and menu strings are functions returning `t(...)`
so they follow a runtime language change. The config type must extend
`PluginConfig` (`{ enabled: boolean }`), which is where the `enabled` flag the
loaders read comes from.

## Process halves

A plugin can provide up to four halves, one per process or moment. Each half is
either a single function (no state, no cleanup) or an object with `start` and
optional `stop` / `onConfigChange` hooks. The renderer object also accepts
`onPlayerApiReady` and `components`.

| Half | Runs in | Context type | Started |
| ---- | ------- | ------------ | ------- |
| `backend` | Electron main process | `BackendContext` | After the main window is created, before the page loads (`loadAllMainPlugins`). |
| `preload` | Preload script, before the renderer bundle | `PreloadContext` | As the preload script runs, after i18n loads. |
| `renderer` | Page world, inside YouTube Music | `RendererContext` | After the page boots, in `loadAllRendererPlugins`. |
| `menu` | Electron main process | `MenuContext` | Whenever the application menu is built, for enabled and essential plugins. |

The menu half is not a lifecycle: `menu(ctx)` is called each time the menu is
rebuilt and returns the items for that plugin's submenu. Returning an empty array
means the plugin still gets a plain enable/disable entry but no submenu
(`src/loader/menu.ts`).

A half that is a plain function gets no `stop`, so it cannot clean up:

```ts
renderer() {
  document.body.classList.add('my-plugin');
},
```

It also cannot be unloaded at runtime: disabling the plugin calls the loader's
unload path, which has nothing to call on a function half, logs the failure and
leaves the half running until the process starts again. Use an object half for
anything users can toggle.

## Contexts

Each lifecycle call receives a context object, typed in
`src/types/contexts.ts`. All contexts share `getConfig` and `setConfig`.

| Context | Members |
| ------- | ------- |
| `BackendContext` | `ipc.send`, `ipc.handle`, `ipc.on`, `ipc.off`, `ipc.removeHandler`, `ipc.removeAllListeners`, `window` (`BrowserWindow`) |
| `PreloadContext` | `getConfig`, `setConfig` only |
| `MenuContext` | `getConfig`, `setConfig`, `window`, `refresh()` |
| `RendererContext` | `ipc.send`, `ipc.invoke`, `ipc.on`, `ipc.off`, `ipc.removeAllListeners` |

`getConfig()` resolves the plugin's declared defaults merged with the stored
config. `setConfig(partial)` writes a partial object; the `enabled` key is
excluded from its type and is owned by the loaders. IPC listeners registered
through `ipc.on` receive the channel arguments without Electron's event object,
and `ipc.off` removes one listener while
`ipc.removeAllListeners(channel)` removes every listener on the channel. Channel
names are global to the app, so namespace them (`peard:<kebab-case>` is the
convention).

```ts
renderer: {
  handler: null as ((value: unknown) => void) | null,

  start({ ipc }) {
    this.handler = (value) => console.log(value);
    ipc.on('peard:my-plugin-event', this.handler);
  },

  stop({ ipc }) {
    if (this.handler) ipc.off('peard:my-plugin-event', this.handler);
    this.handler = null;
  },
},
```

The `menu` half uses `refresh()` to rebuild the application menu after a change
that alters its labels or enabled state; a checkbox updates its own state, so
most menu items do not need it.

## Lifecycle and `this`

A half written as an object stores per-process state as properties, and the
loader binds every function property to that object before `start` runs
(`startPlugin` in `src/utils/index.ts`). That is why `this.api`, `this.listener`
and similar fields work in `start`/`stop`/`onConfigChange`, and why a method can
be passed as an event listener and still see the right `this`. It also means the
object is the place for anything that must survive between calls:

```ts
renderer: {
  api: null as MusicPlayer | null,

  onPlayerApiReady(api) {
    this.api = api;
  },

  stop() {
    this.api = null;
  },
},
```

`start` is awaited by the loader; `stop` is awaited when the plugin is disabled.
A throwing `start` is caught and logged (`[YTMusic] ... execute-failed`), the app
keeps running, and the half is not recorded as started (a renderer half still
counts as loaded when it also declares `stylesheets`). An object half with no
`start` still counts as loaded, because the presence of the object is what the
loader records.

`onConfigChange` is called with the merged config after a write:

- Backend: only while the plugin is loaded and enabled (`src/index.ts`).
- Renderer: only while the plugin is loaded; a disable unloads it before the
  change could reach that hook (`src/renderer.ts`).
- Preload and menu halves do not receive it; the preload half starts with a
  config snapshot, and the menu half runs again on the next menu build.

`onPlayerApiReady(api, ctx)` fires once the YouTube Music player object exists,
after every loaded renderer plugin has started, and again when the plugin is
re-enabled mid-session. The raw player surface is documented in [Player
API](./player-api.md).

## Loading rules

For each half, the loader walks the plugins that have that half and starts it
when either condition holds:

- the plugin is `essential`, or
- the merged `config.enabled` is true. The merged value is the plugin's declared
  default (`{ enabled: false }` when there is no `config`) overlaid with
  `plugins.<id>` from the store.

The rest applies on top:

- `platform` is a static bitmask in the definition. The generated
  `supportsPlatform` helper checks it while the plugin maps are built, so a
  plugin for another OS is left out of those maps and never appears in the menu
  or settings on this one.
- Performance mode skips the renderer half of `ambient-mode`, `blur-nav-bar` and
  `visualizer` (`src/providers/performance-mode.ts`). Their config is untouched,
  and their backend, preload and menu halves still run.
- Enabling or disabling at runtime is driven by the config watcher in
  `src/index.ts`: main starts/stops its own half, sends `plugin:enable` /
  `plugin:unload` to preload and the renderer, then sends `config-changed` with
  the new config.
- `restartNeeded` does not force a restart and does not change the lifecycle: the
  plugin is still started or stopped immediately, and main shows the restart
  dialog (or batches it while a settings window is open) because the change only
  takes full effect after a restart. Per-field restart requirements live on
  `settings` fields and are reported by the settings modal; see [Modifying
  plugins](./modifying.md#restart-requirements).
- Essential plugins cannot be turned off: the settings card hides the switch,
  the menu entry is always checked, and the config watcher forces `enabled` back
  to true.

## Build-time metadata and stripping

`electron.vite.config.mts` builds `virtual:plugins` three times, once per target
(`main`/backend, `preload`, `renderer`), through two Vite plugins:

- `vite-plugins/plugin-importer.mts` generates the module: a loader per plugin,
  a memoized `<target>Plugins()` map containing only plugins with that half, an
  `allPlugins()` map built from `pluginStub`s, and the renderer-only
  `rendererPluginMeta`.
- `vite-plugins/plugin-loader.mts` rewrites each plugin entry during the build.
  It removes the definitions of the other halves from the default export and
  appends a `pluginStub` export with the lifecycle halves stripped, so a
  process bundle carries its own half plus metadata. In the backend build the
  stub keeps `menu`, because main builds the application menu from `allPlugins()`.

`rendererPluginMeta` holds four facts read from the source with ts-morph:
`hasRenderer`, `essential`, `enabled` (the declared default) and `platform`.
`null` means the build could not read the fact; the renderer loader then imports
the plugin definition and reads the real field
(`src/loader/renderer.ts`). The main build uses deferred dynamic imports, so a
plugin module's body runs only when the loader asks for it. The renderer build
uses static imports because wrapping modules in lazy initializers broke the
bundler for it, and preload uses them too because it never supported dynamic
import (see the comments in `plugin-importer.mts`).

Two practical rules follow:

- Keep the default export a directly written object literal, or a
  `createPlugin({ ... })` call with one. The loader looks for exactly that
  shape, and it is the object the build rewrites.
- Keep process-specific code in separate modules referenced from the half. The
  transform edits the definition, not the import list.

## Configuration and stylesheets

Plugin config lives under `plugins.<id>` in the store (an `electron-store`
persisted to `<userData>/config.json`, see `src/config/store.ts`). The plugin's
declared `config` supplies defaults; the loaders merge stored values over them,
and `setConfig` writes partials through `config.setPartial`, which merges arrays
by replacement. See [Modifying plugins](./modifying.md#config-semantics) for the
merge details.

`settings` is rendered by the `settings-ui` plugin, which is itself an essential
plugin. Its keys live at the top level (`settings-ui.*`) instead of under
`plugins.settings-ui.*`, because the settings UI predates that namespace; a new
plugin uses `plugins.<id>.*` like the rest.

`stylesheets` entries are CSS strings, normally imported with `?inline`:

```ts
import style from './style.css?inline';

export default createPlugin({
  // ...
  stylesheets: [style],
  renderer: {},
});
```

The renderer loader turns each string into a `CSSStyleSheet`, adopts it with
`document.adoptedStyleSheets`, and removes it when the plugin unloads. Styles are
global, not scoped: use a plugin-specific selector or class, as
`src/plugins/always-show-volume-slider/style.css` does. A `renderer` half must
exist for the stylesheets to load, even if it is an empty object.

## Where to go next

- [Creating a plugin](./creating.md) - build a new plugin step by step.
- [Modifying plugins](./modifying.md) - add options, menu entries, migrations.
- [Using plugins](./using.md) - enable, configure and troubleshoot plugins.
- [Porting from upstream](./porting-from-upstream.md) - the differences from the
  upstream fork's plugin API.
- [Player API](./player-api.md) - the YouTube Music object handed to
  `onPlayerApiReady`.
- [Architecture](../architecture.md) - where the loaders sit in the boot
  sequence.
- [Conventions](../conventions.md) - i18n, naming, tests and commits.
