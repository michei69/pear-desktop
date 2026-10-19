# Porting a plugin from upstream

This page is for moving a plugin written against upstream
`pear-devs/pear-desktop` into this fork, or for re-applying an upstream change to
a plugin the fork already carries. It assumes you have read the
[Plugin reference](./index.md); this page only covers what differs from
upstream and what the port has to change.

## What upstream plugins look like here

The plugin contract is the same in both trees: `src/plugins/<kebab-id>/index.ts`
exports `createPlugin({...})`, and the definition has `name`, `description`,
`config`, optional `menu`, `stylesheets`, `restartNeeded`, and optional
`backend`/`preload`/`renderer` halves. This fork extends that contract rather
than replacing it:

| Surface | Upstream | This fork |
| --- | --- | --- |
| `PluginDef` | base fields plus contexts | adds `essential`, `settings`, and a renderer `components` map (`src/types/plugins.ts`) |
| Settings UI | no in-app Settings modal; options are edited through `menu` handlers when a plugin has a menu | `settings-ui` essential plugin renders each plugin's `settings` schema in the Settings modal |
| Renderer loading | imports every plugin, then checks the merged config | reads build-time metadata first (`rendererPluginMeta`) and only resolves definitions that cannot be decided statically |
| IPC context | `on` only, no `off` (the renderer had a heavy-handed `removeAllListeners`) | `off` on both contexts, with a per-plugin listener registry so a plugin can unsubscribe exactly its own listener |
| i18n delivery | every locale resource is bundled and imported eagerly | only English plus the active language are loaded; the renderer bundle carries no translations and gets them from preload |
| Themes | no theme plugin | folder-based theme engine in `src/themes`; the earlier `custom-theme` plugin was removed |
| Plugin helpers | `fileExists`, `injectCSSAsFile` in `src/plugins/utils/main/` | removed; use `node:fs` and `injectCSS`; `innertube.ts` helpers were added |
| API server | older route layout under `src/plugins/api-server/backend/` | Hono v1/v2 + MCP layout; not a drop-in merge |

What still works unchanged: `createPlugin` and the `createBackend` /
`createPreload` / `createRenderer` helpers, the lifecycle names (`start`,
`stop`, `onConfigChange`, `onPlayerApiReady`), `menu`, `stylesheets`,
`platform`, `addedVersion`, `restartNeeded`, and the `backend`/`preload`/
`renderer` split. A port is usually an audit of the fields and imports around
that unchanged core.

There is no runtime loader for third-party plugins. The build globs
`src/plugins/*/index.{js,ts,jsx,tsx}` and `src/plugins/*.{js,ts,jsx,tsx}`,
generates `virtual:plugins`, and bundles the result. A ported plugin is compiled
into the app; it is not dropped into a user directory and loaded at runtime.

## Settings: menu-only options must become a schema

Upstream plugins commonly configure themselves through `menu` handlers that call
`ctx.getConfig()` / `ctx.setConfig()`. `menu` still works here, but the in-app
Settings modal is the primary configuration surface, and it only shows what the
plugin declares in `settings`. A ported plugin with only a `menu` will look
configurable in the native menu and empty in Settings.

`src/plugins/disable-autoplay/index.ts` is a real before/after example. Upstream:

```ts
config: {
  enabled: false,
  applyOnce: false,
},
menu: async ({ getConfig, setConfig }) => {
  const config = await getConfig();
  return [
    {
      label: t('plugins.disable-autoplay.menu.apply-once'),
      type: 'checkbox',
      checked: config.applyOnce,
      async click() {
        setConfig({ applyOnce: !(await getConfig()).applyOnce });
      },
    },
  ];
},
```

The fork adds the same option declaratively:

```ts
settings: [
  {
    type: 'switch',
    key: 'applyOnce',
    label: () => t('plugins.disable-autoplay.menu.apply-once'),
  },
],
```

The schema type is `SettingsSchema` in `src/types/settings.ts`: either a flat
`SettingField[]` or a `SettingsGroup[]` when the options need headings (the
scrobbler does this per provider). Supported field types:

| `type` | Purpose | Notable extras |
| --- | --- | --- |
| `switch` | boolean | |
| `select` | one of a list | `variant: 'radio'` or `'dropdown'`, async `options`, `refreshable`, `languageSync` |
| `slider` | bounded number | `min`, `max`, `step`, `unit`, `scale` |
| `number` | plain number | `min`, `max`, `step`, `unit`, `placeholder` |
| `text` | string | `placeholder` |
| `multiselect` | several of a list | |
| `orderable` | ordered list | `options` supply the rows; up/down buttons reorder them |
| `action` | one or buttons | `onClick({ getValue, setValue, pickDirectory, pickFile })` |
| `custom` | Solid component | `component: '<pluginId>.<name>'`, resolved through the renderer `components` map |

Every field also accepts `restartNeeded` (that one setting needs a restart),
`platform` (a `Platform` bitmask), `visible` (a predicate evaluated while the
modal renders) and `hideLabel`. Labels and descriptions are functions
(`() => t(...)`) because the language can change without a reload; `options` may
be a function and may return a promise when the list comes from disk or the
network. The full field reference is in
[Creating a plugin](./creating.md#settings-schema); if the fork already carries
the plugin you are porting, extend it as described in
[Modifying plugins](./modifying.md).

Keys are dotted paths into the plugin's own config, so nested options do not
need a custom field: the scrobbler declares `scrobblers.lastfm.apiKey`,
`scrobblers.listenbrainz.token` and so on, and the downloader declares
`downloadOnFinish.mode`. The modal reads and writes them through
`getByPath`/`setByPath` in `src/plugins/settings-ui/paths.ts`; a write crosses
`peard:set-config` and lands in the same `config.setPartial` call a menu
`setConfig` makes. That means:

- writes deep-merge into `plugins.<id>`; an unrelated option is not clobbered;
- `onConfigChange` fires for loaded plugins exactly as it does for menu writes;
- slider writes are debounced in the modal, so do not assume one write per pixel.

A custom field needs two halves: `component: '<pluginId>.<name>'` in the schema
and a renderer `components` entry. `src/plugins/equalizer/index.ts` is the small
example:

```ts
settings: [
  {
    type: 'custom',
    key: 'presets',
    label: () => t('plugins.equalizer.menu.presets.label'),
    component: 'equalizer.presets',
    restartNeeded: true,
  },
],
renderer: {
  components: { presets: EqualizerPresets },
  // ...
},
```

The component receives `{ ctx: CustomFieldContext }`, which is the field's
`getValue(key)` / `setValue(key, value)` pair, so it can write below its own key
(the equalizer writes `presets.<name>`). Custom fields are resolved only from
the renderer half; a `custom` field with no matching component renders
`missing component: <id>` instead of crashing.

## Translations

The rule and the key layout are in
[Conventions](../conventions.md#user-facing-text-and-translations). Upstream code
may not meet all of it; audit before porting.

- Every user-facing string goes through `t` from `@/i18n`, including menu items,
  settings labels, dialog text and toast messages.
- English keys go in `src/i18n/resources/en.json` under `plugins.<id>.*`. Other
  locales are optional in a change and are normally filled in later through
  Weblate.
- `name` and `description` are functions: `name: () => t('plugins.<id>.name')`.
  The settings schema's `label`/`description`/`placeholder` are functions too.
- Console messages that describe app state belong under `common.console.*` and
  are translated in both trees; internal debug logging is the exception.
- The renderer has no translation loaders of its own. Preload injects the loaded
  resources as `globalThis.__PEAR_I18N_RESOURCES__` and the renderer initializes
  i18next from them, so a plugin must not import a language JSON directly.

A minimal resource entry for the ported plugin:

```json
"plugins": {
  "disable-autoplay": {
    "name": "Disable Autoplay",
    "description": "Makes song start in \"paused\" mode",
    "menu": {
      "apply-once": "Applies only on startup"
    }
  }
}
```

If you rename an option while porting, update `en.json` in the same change. A
key left behind is dead weight; a key removed while code still calls it renders
the key string to the user.

## Static plugin metadata

The renderer decides what to start without necessarily resolving each plugin
definition. `vite-plugins/plugin-importer.mts` reads the plugin source with
ts-morph at build time and emits `rendererPluginMeta`, one entry per plugin:

```ts
{ "settings-ui": { "hasRenderer": true, "essential": true, "enabled": true, "platform": null } }
```

`src/loader/renderer.ts` uses that to skip plugins without a renderer, filter by
`platform`, and decide `essential || enabled`. When `hasRenderer`, `essential`
or `enabled` could not be read, it imports the definition and uses the real
object instead. The fields that must be statically readable:

| Field | Accepted form | When unreadable |
| --- | --- | --- |
| `renderer` | property present or absent on the definition | `hasRenderer: null`, definition imported |
| `config.enabled` | literal `true` / `false` in the inline config object (or a config identifier ts-morph can follow to one) | `enabled: null`, definition imported |
| `essential` | literal `true` / `false`; absent means `false` | `essential: null`, definition imported |
| `platform` | numeric literal, `Platform.Name`, or a bitwise-OR combination of those | `platform: null`; the metadata pass treats the plugin as available on every platform and the real definition decides after import |

The harder constraint is the second build pass, `vite-plugins/plugin-loader.mts`.
For each bundle it rewrites the plugin module: the main bundle keeps `backend`
and `menu`, preload keeps `preload`, the renderer keeps `renderer`, and a named
`pluginStub` export is added everywhere - a copy of the definition with the
lifecycle implementations removed (the backend stub keeps `menu`, because main
builds the application menu from `allPlugins()`). `allPlugins()` lists plugins
from that stub, so the main process can build its menu without pulling renderer
code into its bundle. The transform recognizes only two shapes:

```ts
export default createPlugin({ /* object literal */ });
export default { /* object literal */ };
```

If the definition is a variable (`const def = {...}; export default def;`), a
call with a non-literal argument, or a cast such as
`createPlugin({...} as PluginDef<...>)`, the loader cannot find the object
literal: it emits the module unchanged and the generated `virtual:plugins`
imports a `pluginStub` that does not exist. The preload and renderer builds fail
on that missing named export, and the main plugin map would be broken at runtime.
Keep the definition's object literal inline even though the metadata pass is more
forgiving. A top-level spread inside the object is a different problem: it is
copied into the stub as-is, so whatever process-specific properties it carries
are not stripped; keep the half properties written out explicitly.

Two more build-time rules:

- The entry file is `src/plugins/<id>/index.ts` (or `.tsx`/`.js`/`.jsx`, or a
  bare `src/plugins/<id>.ts`). Nested files that are not the entry are not
  plugins; `src/plugins/utils/**` is excluded from discovery on purpose.
- `addedVersion` is compared against `package.json` with semver's `satisfies`
  (`src/menu.ts`) to render the **NEW** badge. A ported plugin should use the
  release line that will actually ship it, for example `'3.13.X'`.

## Lifecycle and IPC differences

The per-process contexts are in `src/types/contexts.ts`. The base is unchanged:
`getConfig()` returns the merged config, and `setConfig(partial)` writes through
`config.setPartial`. `setConfig` cannot change `enabled`; the type is
`Partial<Omit<Config, 'enabled'>>` because enabling is owned by the loaders and
the config watcher.

The IPC surface grew in this fork:

| Context | Upstream | This fork |
| --- | --- | --- |
| `backend` | `send`, `handle`, `on`, `removeHandler` | adds `off` and `removeAllListeners` |
| `preload` | config only | config only |
| `renderer` | `send`, `invoke`, `on`, `removeAllListeners` | adds `off` |
| `menu` | `window`, `refresh` | unchanged |

`off(channel, listener)` removes exactly the listener you registered, using a
registry kept per plugin id. This matters because the context object is recreated
for every lifecycle call and the preload-side subscription is a different
function object than the one you passed in; the registry maps your listener to
the wrapper or unsubscribe closure that was actually registered. The rule when
porting: keep a reference to every handler, add it through `ctx.ipc.on`, and
remove it in `stop` with `ctx.ipc.off`. The sponsorblock plugin's shape:

```ts
start({ ipc }) {
  this.handleSkipSegments = (segments) => (currentSegments = segments);
  ipc.on('sponsorblock-skip', this.handleSkipSegments);
},
stop({ ipc }) {
  ipc.off('sponsorblock-skip', this.handleSkipSegments);
},
```

Upstream code often had no `off`, so it either leaked the listener across
disable/enable cycles or reached for `removeAllListeners`, which still drops
every listener on the channel (`ipcMain.removeAllListeners` /
`ipcRenderer.removeAllListeners`), including ones registered by the app or
another plugin. Do not use it on a shared channel; prefer `off`.

Channel naming matters for the same reason. App and plugin channels use
`peard:<kebab-case>` (`peard:player-api-loaded`, `peard:update-song-info`,
`peard:audio-can-play`). The Settings UI keeps the historical
`ytmd-sui:<kebab-case>` prefix for its own channels. A few app control channels
are unprefixed and are owned by main (`plugin:enable`, `plugin:unload`,
`config-changed`); a ported plugin should not send or listen on those.

Two lifecycle details that differ from what a naive port assumes:

- `forceLoadRendererPlugin` refuses to start a plugin that is already loaded, so
  a duplicate `plugin:enable` does not re-run `start`. The enable handler still
  calls `onPlayerApiReady` afterwards when the player exists, so that hook has to
  be idempotent.
- The renderer only calls `onPlayerApiReady` for plugins whose `renderer` is an
  object. A plugin written as a single `renderer` function cannot use that hook.
  The hook itself is covered in [Player API](./player-api.md).

## App-level options a port needs

Most ported plugins keep their options under `plugins.<id>` and only need the
settings schema. If the feature genuinely belongs to the app (a window style, a
link rewriter, a performance switch), it must be an app option, and an app
option is only complete when all of these agree - the checklist is also in
[Conventions](../conventions.md):

1. `src/config/defaults.ts` - the default and its type.
2. `src/plugins/settings-ui/schema/app-settings.ts` - the control in the modal.
3. `src/menu.ts` - the native menu entry, if the option has one.
4. `src/providers/option-effects.ts` - side effects that must happen
   immediately (window flags, tray icons, renderer pushes).
5. `src/preload.ts` - add the key to `rendererConfigKeys` if the page reads it.
   `window.mainConfig.get` returns `undefined` for anything not on the list.
6. `src/config/store.ts` - a migration if a stored key is renamed or removed.

`restartNeeded` is not a single switch. On the plugin definition it means
"enabling/disabling this plugin needs a restart" and drives the restart dialog
in `src/index.ts`. On a settings field it means "this value is read once at
startup" and drives the restart banner in the modal. A plugin can be
live-toggleable and still have startup-only fields: the equalizer declares
`restartNeeded: false` on the plugin but `restartNeeded: true` on its `presets`
field.

Feature flags are an app option, not a plugin option:
`options.featureFlags` is applied to YouTube Music's `ytcfg` before the page's
scripts run (`startFeatureFlags` in
`src/plugins/settings-ui/flags-preload.ts`, installer in
`src/plugins/settings-ui/injectors/flags.ts`) and is edited in the Settings flags
section. A ported plugin that used to poke `EXPERIMENT_FLAGS` itself should
either stop doing that or document the flag the user must set.

## Port checklist

1. Copy the upstream plugin into `src/plugins/<id>/index.ts` (lower-case
   kebab-case; the folder name is the plugin id and the config namespace). If
   the fork already has the plugin, follow
   [Modifying plugins](./modifying.md) instead of replacing it.
2. Keep the top-level definition an inline `createPlugin({...})` object literal
   so `pluginStub` generation works, and make `config.enabled`, `essential` and
   `platform` literal.
3. Add `settings` for every option the ported plugin exposes. Do not rely on the
   menu as the only entry point.
4. Add `plugins.<id>.*` keys to `src/i18n/resources/en.json`; remove keys whose
   options disappeared.
5. Port IPC cleanup to `ctx.ipc.off`; rename channels to `peard:*` unless the
   plugin already owns a prefix.
6. Replace imports that no longer exist (`fileExists`, `injectCSSAsFile`,
   removed provider modules) and check `src/types/` for moved types.
7. Decide whether a renamed plugin id needs a migration in `src/config/store.ts`.
8. Run the checks:

```bash
pnpm check   # oxlint, oxfmt --check, tsc --noEmit
pnpm test    # Playwright runner; most tests are plain Node, a few launch Electron
pnpm build   # the real test of pluginStub generation and virtual:plugins
```

`pnpm build` matters more for a port than for ordinary code: it exercises the
static metadata pass and the stub transform, so a definition that typechecks can
still fail here.

## Pitfalls

- **Arrays in plugin configs concatenate on read.** The loaders merge
  `def.config` with the stored config using `deepmerge-ts`'s default behaviour,
  where arrays concatenate, so a non-empty default array is prepended to the
  stored one every time `getConfig()` runs. This fork writes app config with
  `mergeArrays: false` (`src/config/index.ts`), but plugin `getConfig` does not.
  The synced-lyrics plugin avoids a default for `providerPriority` for exactly
  this reason and names the absent value in a comment. Omit user-editable array
  defaults. The full write/read semantics are in
  [Modifying plugins](./modifying.md#config-semantics).
- **Old ids were renamed.** Porting from an older commit that still uses
  `adblocker`, `lyrics-genius`, `lastfm` or `hide-video-player` creates a second
  plugin and orphaned config. Check the migrations in `src/config/store.ts`
  before choosing an id.
- **Listener leaks across enable/disable.** Disabling a plugin calls `stop`; if
  `stop` does not remove every listener and observer, re-enabling stacks another
  copy. `forceLoadRendererPlugin` guards against loading twice, not against
  duplicate listeners inside the plugin.
- **Global `removeAllListeners`.** It removes the app's and other plugins'
  listeners on that channel. Use `off`.
- **`restartNeeded` is not "reload on save".** Nothing is reloaded for you;
  main shows the restart dialog and the user restarts. Do not write code that
  depends on a live reload of a startup-time value.
- **Stale translation keys.** A renamed option leaves both keys; a deleted
  option leaves a key. Grep `plugins.<id>` in `en.json` against the schema.
- **Stylesheet strings.** `stylesheets` takes CSS text, not file paths. Import
  the file with `?inline` (`import style from './style.css?inline'`) as the
  existing plugins do. The renderer adopts each plugin's sheets and removes them
  on unload; main-process plugins do not get this treatment, and the sheets only
  load if the plugin has a `renderer` half (an empty object is enough).
- **Imports are not rewritten.** The stub transform edits the definition, not the
  import list. A backend-half plugin whose entry module imports renderer-only
  code still bundles and evaluates that code in main; keep process-specific code
  in separate modules referenced from the half that needs it.
- **Platform detection is static.** `platform` is turned into the bitmask at
  build time, so it cannot depend on runtime information. If it is not readable,
  the plugin is considered for every platform and filtered after import.
- **`config.enabled` defaults to false.** Upstream plugins that ship enabled by
  default declare `enabled: true`; an omitted `config` means disabled, and an
  omitted `enabled` in an inline config means disabled too.
