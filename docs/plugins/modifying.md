# Modifying plugins

This page is for changing an existing plugin: adding an option and its settings
field, adding a menu entry, growing a plugin to a new process, reacting to config
changes, renaming a stored key with a migration, and getting restart behaviour
right. It assumes the structure described in [Plugins overview](./index.md); the
plugin being extended is usually small enough that a `types.ts` or the entry file
holds its config type.

## Find the plugin and its config

A plugin lives in `src/plugins/<id>/` (or as `src/plugins/<id>.ts`) and its id is
the folder or file name. Its config type and default object are in the entry file
or in a `types.ts` beside it, for example
`src/plugins/ambient-mode/types.ts`. The entry file default-exports
`createPlugin({ ... })`; if it has several halves, they are usually in
`backend.ts`, `menu.ts`, `renderer.ts` and imported into the literal.

All plugin config is stored under `plugins.<id>` in the config file, and the
loaders merge the stored values over the plugin's `config` defaults. Changing the
default object is therefore enough to introduce a new key without a migration,
for users who never wrote it.

## Add a config option

Assume a plugin whose config currently is `{ enabled: boolean }` and which has a
renderer half. Add the option in four places, then wire its behaviour.

First, the type and the default:

```ts
export type MyPluginConfig = {
  enabled: boolean;
  fadeMs: number;
};

const defaultConfig: MyPluginConfig = {
  enabled: false,
  fadeMs: 500,
};
```

Second, the settings field. Choose the field type from
[the settings schema](./creating.md#settings-schema), give it a dotted `key`
matching the config shape, and translate the label:

```ts
settings: [
  {
    type: 'slider',
    key: 'fadeMs',
    label: () => t('plugins.my-plugin.settings.fade'),
    min: 0,
    max: 2000,
    step: 50,
    unit: 'ms',
  },
],
```

Third, read the value where the plugin uses it. Read it in `start` for the
initial value and in `onConfigChange` for later writes; do not read it once into a
module-level constant unless the plugin really only wants the startup value:

```ts
renderer: {
  fadeMs: defaultConfig.fadeMs,

  async start({ getConfig }) {
    const config = await getConfig();
    this.fadeMs = config.fadeMs;
    this.applyFade();
  },

  onConfigChange(newConfig) {
    this.fadeMs = newConfig.fadeMs;
    this.applyFade();
  },
},
```

Fourth, add the English string under the plugin's existing namespace in
`src/i18n/resources/en.json`:

```json
"my-plugin": {
  "settings": {
    "fade": "Fade duration"
  }
}
```

If the plugin still exposes its options in a native menu entry, update that
function too (see the next section). The settings schema is the primary UI for an
option; a menu entry is optional.

If the value is read only when the app starts (a startup flag, a listener
registered at boot), mark the field `restartNeeded: true` so the settings modal
shows the restart pill and reports the requirement when it closes. See
[Restart requirements](#restart-requirements).

## Dotted keys and nested config

Settings keys are dotted paths, and the settings UI resolves them through
`src/plugins/settings-ui/paths.ts` (`getByPath`, `setByPathCopy`,
`nestPartial`). A field with `key: 'downloadOnFinish.enabled'` reads
`config.downloadOnFinish.enabled`, and a write is sent as the nested partial
`{ downloadOnFinish: { enabled: true } }`, which `setPartial` merges into the
stored config. The downloader's finish settings in
`src/plugins/downloader/index.ts` are a working example.

Two consequences:

- The default object must contain the nested object, otherwise the first read
  before any write has no value to fall back on.
- A `custom` settings component may write below its field's key
  (`presets.classical`); a `restartNeeded` on that field covers writes with the
  field's key as a prefix (`src/plugins/settings-ui/components/SettingsModal.tsx`).

## Add a menu entry

A plugin's `menu` half returns `Electron.MenuItemConstructorOptions[]`, is called
each time the application menu is built, and is only loaded for enabled or
essential plugins. Add the entry to the existing array in `menu.ts` (or to the
`menu` function in the entry file):

```ts
import { type MenuItemConstructorOptions } from 'electron';

import { t } from '@/i18n';
import { type MenuContext } from '@/types/contexts';

import { type MyPluginConfig } from './index';

export const menu = async ({
  getConfig,
  setConfig,
}: MenuContext<MyPluginConfig>): Promise<MenuItemConstructorOptions[]> => {
  const config = await getConfig();

  return [
    {
      label: t('plugins.my-plugin.menu.reset'),
      type: 'normal',
      click() {
        setConfig({ fadeMs: 500 });
      },
    },
  ];
};
```

The context's `refresh()` rebuilds the whole application menu. Call it when the
change alters labels or the checked/enabled state of other items; checkbox and
radio items update their own state, so a simple option toggle does not need it.
`src/plugins/ambient-mode/menu.ts` is a real example of radio submenus backed by
`setConfig`.

The native menu is built at startup and rebuilt by `refreshMenu`; toggling a
plugin from the in-app settings starts or stops it but does not rebuild the
native menu, so a newly enabled plugin's submenu appears at the next rebuild (a
restart, a menu action that refreshes, or an explicit `refresh()` from plugin
code).

## Add a process half

The loaders do not care how many halves a plugin has; adding one is a matter of
creating the module and adding the property to the definition.

For a backend, create `backend.ts` with `createBackend`, keep its state in the
first type argument, and add `backend` to the entry:

```ts
import { createBackend } from '@/utils';

import type { MyPluginConfig } from './index';

export const backend = createBackend<
  { interval: NodeJS.Timeout | null },
  MyPluginConfig
>({
  interval: null,

  start({ ipc }) {
    this.interval = setInterval(() => ipc.send('peard:my-plugin-tick'), 1000);
  },

  stop({ ipc }) {
    clearInterval(this.interval ?? undefined);
    this.interval = null;
  },
});
```

`src/plugins/memory-saver/index.ts` shows the same shape with config access and
`onConfigChange`. For a preload half the pattern is `createPreload`; see
`src/plugins/prefer-song/index.ts`. For a renderer half, add `renderer` to the
definition or extend the existing object; renderer halves also accept
`onPlayerApiReady` and the `components` registry.

Converting a one-function half into an object does not change loading rules, but
it is what enables `stop` and `onConfigChange`, and without `stop` the loader
cannot unload the half at runtime. Do the conversion when the half starts
allocating resources: listeners, observers, timers, DOM nodes, adopted
stylesheets.

## Handle config changes

`onConfigChange` receives the merged config after every write, but only where the
half is loaded:

- Backend hooks run only while the plugin is enabled and its backend is loaded.
- Renderer hooks run only while the renderer plugin is loaded.
- Preload starts with a snapshot and is not notified; re-read with `getConfig`
  when the value is needed later.
- The menu half runs again on the next menu build, so it always reads fresh
  values.

Keep the half's state and the config in sync:

```ts
onConfigChange(newConfig) {
  this.fadeMs = newConfig.fadeMs;
  this.applyFade();
},
```

`src/plugins/ambient-mode/index.ts` re-applies its visual settings from
`onConfigChange`, and `src/plugins/downloader/index.ts` forwards changes to its
main-process work. A half that ignores `onConfigChange` keeps using stale values
until it restarts.

## Config semantics

Writes and reads do not merge arrays the same way, and the difference matters when
an option is a list:

- `ctx.setConfig(partial)` calls `config.setPartial`, which deep-merges using
  `deepmerge-ts` with `mergeArrays: false` (`src/config/index.ts`). An array in
  the partial replaces the stored array.
- `getConfig()` merges the plugin's declared defaults with the stored config
  using `deepmerge-ts`'s default array behaviour, where arrays concatenate. A
  non-empty default array is therefore prepended to the stored array on every
  read; `src/plugins/synced-lyrics/index.ts` documents this and deliberately
  declares no default for `providerPriority`.
- The settings UI sends writes through the same `setPartial` path, so a custom
  component writing an array should write the complete list.

Prefer declaring no default for a user-editable array, or declaring an empty one,
and always write the full array you want stored. `enabled` is not part of
`setConfig`: the type omits it and the loaders own it, so a plugin cannot disable
itself from its own lifecycle.

## Migrate a renamed or removed option

Renaming or removing a stored key needs a migration in `src/config/store.ts`,
because existing config files still contain the old value. Migrations are keyed
by the release that introduces them and run once per store when the app's base
version satisfies the range:

```ts
'>=3.13.0'(store: IStore) {
  const config = store.get('plugins.my-plugin') as
    | Record<string, unknown>
    | undefined;
  if (!config || config.fadeDuration === undefined) return;

  config.fadeMs = config.fadeDuration;
  delete config.fadeDuration;
  store.set('plugins.my-plugin', config);
},
```

Rules observed by the existing entries in that object:

- The key is a range such as `'>=3.12.3'` and names the release that ships the
  change. `store.ts` runs with `projectVersion = migrationBaseVersion(version)`,
  so a beta and its final release share one migration marker
  (`src/providers/app-versions.ts`).
- Guard on the old key existing. A fresh install has no stored plugin config, and
  a user who never set the option has nothing to migrate.
- Copy, then delete the old key, and keep the write idempotent.
- Do not number migrations by hand; `conf` applies the applicable keys in the
  order they appear in the object, then stores the app's base version as the
  migrated version.
- Extract anything testable into `src/config/migrations.ts`, which is
  Electron-free and covered by tests, and call it from `store.ts`. The 3.12.3
  synced-lyrics and 3.12.0 adblocker migrations are the patterns to copy.
- Remove the old i18n keys and any settings fields in the same change; do not
  leave a key in the resources that no code references.

Existing migrations show the three common shapes: a rename
(`preferredProvider` to `providerPriority`), a plugin rename (`adblocker` to
`do-not-track`), and a plugin merge (`lyrics-genius` into `synced-lyrics`).

## Restart requirements

There are two levels, and they mean different things:

- `restartNeeded: true` on the plugin makes enabling or disabling it require a
  restart. The lifecycle still starts or stops the plugin immediately; main shows
  the restart dialog (or batches it while a settings window is open) because the
  change only takes effect fully after a restart. Use it when the plugin patches
  something that is only read once per process.
- `restartNeeded: true` on a settings field marks that option as read at startup.
  The modal shows a pill next to the field and a banner when it changes, and the
  restart requirement names the field. Use it instead of restarting on every
  write, as `src/plugins/equalizer/index.ts` does for its preset field.

Do not set either when the plugin already handles the change live in
`onConfigChange`; the restart dialog is user-visible friction. The
`options.restartOnConfigChanges` app option, when enabled, restarts the app on any
menu-driven config write, which is separate from these markers and not a reason
to add them.

## Update tests and translations

- Add or extend tests for the pure parts of the change: option normalization,
  parsing, path handling. Note
  `tests/skip-ai-slop-config.test.ts`, which exercises the normalizers behind
  settings fields without an Electron process.
- Put plugin-local tests in `src/plugins/<id>/tests/`; cross-cutting ones stay in
  `tests/`. Both use `@playwright/test` as a plain test runner (`pnpm test`).
- Add the English strings for every new label, description and menu entry under
  `plugins.<id>.*`; other locales are normally filled in later. Removing an option
  removes its keys, and renaming one renames the keys in the same change.
- Run `pnpm check` (lint, format check, typecheck) before review; it catches
  config-type and context-type drift that the settings schema's string keys do
  not.

## Checklist

- Config type, default object, settings field and menu entry (if any) all carry
  the new option.
- The value is read in `start` and updated in `onConfigChange`, or marked
  `restartNeeded` when it is startup-only.
- Dotted keys have their nested default object, and arrays are written whole.
- Renamed or removed stored keys have a guarded migration and no leftover i18n
  keys.
- Every new resource is released in `stop`.
- Tests cover the pure logic, the labels are translated, and `pnpm check` passes.
