# Modifying plugins

This page covers changes to an existing plugin: options, commands, buttons, menus, stored config and tests. The field and context reference is in [Plugins overview](./index.md).

## Files in a plugin

A plugin is one workspace package under `plugins/<id>/`. The entry is `index.ts` or `index.tsx`; helper modules sit beside it, and larger page UIs use a `page/` folder (see `plugins/downloader/page/` and `plugins/synced-lyrics/page/`). Tests live in `test/`.

The entry must keep the shape `export default definePlugin({ ... })`. The build finds that object and splits it for the host and page bundles. Imports referenced only from one half are pruned from the other, so put a host-only dependency behind host code and a page-only UI behind page code.

Package dependencies are added to the plugin's own manifest:

```sh
nub add --filter @pear/plugin-do-not-track some-package
```

## Add or change an option

Add a field to `config`:

```ts
config: {
  skipShorts: config.bool(true, {
    label: "Skip Shorts",
    description: "Treat Shorts as tracks to skip.",
    group: "Playback",
  }),
},
```

Then:

1. Read `ctx.config.skipShorts` where it matters.
2. Apply live changes from `onConfigChange` when possible, or let the part restart and read the new value in `start`.
3. Run `nub run i18n` to add `plugins.<id>.settings.skip-shorts.label` and `.description`.
4. Add a unit test for the behavior, not for the schema.
5. If the default changes, decide whether existing users should keep their stored value; a default change does not rewrite stored config.

The settings UI is generated from the field; there is no separate UI file. A field's `group` becomes a heading. A field's `restart: true` shows a restart pill but does not itself restart anything; the plugin host still applies the write with its normal restart-or-listener rule.

Removing an option: remove the field, its key from the code, its use and its translation entry. `normalizeConfig()` drops the stored key the next time the plugin's config is read. If the old value must be carried into a new shape, add a migration (below).

## Add a host command

Host commands are the page's typed API into the main process:

```ts
host: {
  commands: {
    async exportPlaylist(id: string) {
      const path = join(this.app.getPath("documents"), `${id}.json`);
      await writeFile(path, JSON.stringify(this.player.state, null, 2));
      return path;
    },
  },
},
```

Call it from the page with `await ctx.host.invoke("exportPlaylist", id)`. The command runs only while the plugin is enabled. `this` is the host context, so use `this.player`, `this.config`, `this.setStatus`, `this.log` and the rest.

Commands are not RPC. They are private to the plugin's two halves and are not exposed over HTTP.

## Add a settings button

Declare the action and the host command with the same name:

```ts
actions: {
  clear: { label: "Clear history", description: "Forgets the saved entries." },
},
host: {
  commands: {
    clear() { /* … */ },
  },
},
```

The button appears while the plugin is enabled. Its labels are translated through `plugins.<id>.actions.<name>.label` and `.description`, added by `nub run i18n`.

## Add an API server method

`host.rpc` exposes a method to other apps:

```ts
import { v } from "@pear/sdk/rpc";

host: {
  rpc: {
    status: {
      summary: "What the plugin is doing",
      input: v.object({ verbose: v.optional(v.boolean(), false) }),
      run({ verbose }) {
        return { enabled: true, track: verbose ? this.player.state.track : undefined };
      },
    },
    reset: {
      summary: "Forget everything the plugin stored",
      input: v.object({}),
      run() { this.reset(); },
    },
  },
},
```

The API server checks `input` before calling `run`, types its parameter and documents the method in `/doc` and `/swagger`. A method with no parameters still needs an input schema, usually `v.object({})`. Return JSON-serializable data; `undefined` produces 204.

To push events to API clients, use `ctx.api.broadcast(event, data)`. It is a no-op while the server is off. Payloads arrive as `{ type: "PLUGIN_EVENT", plugin, event, data }`.

## Add a menu item

```ts
host: {
  start(ctx) {
    ctx.addMenuItem({
      label: ctx.t("plugins.my-plugin.menu.show", "Show my plugin"),
      accelerator: "CmdOrCtrl+Shift+M",
      click: () => ctx.focusWindow(),
    });
  },
},
```

Menu items appear under Options in the native menu and in the tray menu, and disappear when the plugin stops. The tray plugin also lists them through `ctx.pluginMenuItems()` and refreshes on `ctx.onMenuItemsChange`.

## Change styles and selectors

- Static CSS belongs in `style`, written with the `css` macro.
- Dynamic CSS uses `ctx.addStyle`, whose handle can be updated.
- Selectors come from `packages/sdk/src/selectors.ts`. Add a missing one there, with a comment naming both player-bar layouts when it differs; then use it from `ctx.$`, `ctx.waitFor` or `sel()`.
- Never match YTM's internal class names directly. They change per layout and per rollout.

## Add page behavior

Use the page context instead of raw DOM APIs so cleanup is automatic: `ctx.listen`, `ctx.observe`, `ctx.mount`, `ctx.setTimeout`, `ctx.addStyle`, `ctx.audio()`. Anything else needs `ctx.onCleanup`.

Visual loops should check `ctx.isWindowVisible()` and `ctx.player.state.ad`, as `plugins/ambient-mode`, `plugins/visualizer` and `plugins/synced-lyrics` do. The window keeps rendering while hidden, so the check is the only way to pause.

Audio plugins must not connect the `<video>` to a new `AudioContext`: a media element can have only one source node. Use `ctx.audio()`, the shared graph, which exposes `insert(input, output?, order?)` to add a processing stage and `tap(node)` to observe the final output. The equalizer, compressor and visualizer are examples.

## Stored config and migrations

Plugin config lives at `plugins.<id>` in `<userData>/config.json`. The plugin's schema supplies defaults; stored values are normalized on read. Changing the meaning of a stored key needs a migration, because existing users keep their file.

Migrations live in `apps/desktop/src/main/migrations/plugins.ts` (plugin entries and window files) and `migrations/index.ts` (app-level moves). Rules:

- Add a function to `PLUGIN_MIGRATIONS` keyed by plugin id. It receives the stored entry, the whole config and the files-to-create map.
- Use `setNew()` so an existing new key is never overwritten, `copyTyped()`/`flattenStrings()` for renamed keys, `fractionToPercent()` and `clampNumber()` for old value ranges, and `ensurePluginEntry()` for new plugin entries.
- Old keys stay in the file. Unknown keys are preserved on purpose, so a downgrade still works.
- Never edit a migration that has shipped. Add another one, or extend the current unreleased one only while it has not left `master`.
- A migration that creates a file next to `config.json` (for example moved window bounds) returns it through the `files` map; `config.ts` writes it only when it does not exist.
- Add a case to `apps/desktop/test/plugin-migrations.test.ts` and, when app-level keys move, `apps/desktop/test/config.test.ts`.

The `4.0.0` migration also converts pear-desktop 3.x plugin options. See `migrations/plugins.ts` for the renamed ambient-mode, album-color-theme, auth-proxy-adapter, crossfade, custom-output-device, discord, do-not-track, downloader, equalizer, in-app-menu, notifications, picture-in-picture, playback-speed, precise-volume, scrobbler, shortcuts, skip-ai-slop, sponsorblock, synced-lyrics, transparent-player and visualizer options. App-level moves in `migrations/index.ts`: the tray options became the tray plugin's, `hideVideoCaptions` stays a core option now, `contextMenuHidden` became per-entry switches, and the `options.featureFlags` record became `options.siteFlags` "name=value" entries.

## Restart requirements

Two different things need a restart:

- **Plugin-level**: `restartRequired` (or `host.beforeReady` / `host.windowOptions`). Enabling or disabling the plugin only fully applies after an app restart. The page part starts only when the plugin was enabled at page load.
- **Field-level**: `restart: true`. The value is written normally, but the user should restart for it to take effect.

The settings card shows a pill for the first, each field shows a pill for the second, and the dialog collects both in the restart banner. The banner's "Restart now" calls `app:relaunch`. Do not show your own restart dialog.

When a part could apply a config change but the hook is not implemented, the host restarts the part automatically. The hook is preferred: `start` may own resources that are expensive to rebuild.

## Tests and docs

- Unit tests go in `plugins/<id>/test/*.test.ts`; the package needs `"test": "vitest run"` in `scripts`. Run `nub run test`.
- E2E tests go in `apps/desktop/e2e/` and use `launch({ plugins: { ... } })`, `setConfig`, `setEnabled` and `pluginError`/`pluginStatus` from `e2e/helpers/plugins.ts`. Run `nub run test:e2e <name>`.
- Update [Using plugins](./using.md) if the user-facing behavior changes, and the relevant page in `docs/` if the architecture changes.
- Run `nub run format`, `nub run lint`, `nub run typecheck` and `nub run i18n --check` before committing.

## Removing a plugin

Delete the folder and its workspace entry, then remove references: imports, migration entries, docs, README feature lists and tests. Its `plugins.<id>` key may stay in user configs; unknown plugin entries are harmless and are not loaded. Do not reuse the old id for a different plugin, because the stored config would be inherited.
