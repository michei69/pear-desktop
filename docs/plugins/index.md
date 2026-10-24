# Plugins

This page is the reference for the plugin system: discovery, definition fields, the host and page parts, contexts, config, communication and cleanup. [Creating a plugin](./creating.md) walks through writing one; [Using plugins](./using.md) covers the user-facing side.

Plugins are compiled into the app. The build scans `plugins/`, so every plugin ships inside the bundle; there is no plugin store and no folder in the user's data directory for third-party plugins. Themes are the external, user-installable extension; see [Themes](../themes/index.md).

## Discovery

`packages/vite-plugin-pear/src/index.ts` scans `plugins/` for:

- `plugins/<id>/index.ts`
- `plugins/<id>/index.tsx`

Each plugin is a workspace package (`packages/*` and `plugins/*` are in the root `package.json` `workspaces` field), usually `@pear/plugin-<id>`, with its own `package.json` and `tsconfig.json`. The folder name is the plugin id. It appears unchanged in config keys, RPC paths and `ctx.id`; the generated module identifier is the same id in camelCase.

`PEAR_ONLY_PLUGINS=a,b` limits discovery during a build or test run. `scripts/new-plugin.ts` creates the folder, the package manifest, the tsconfig and a minimal `index.ts`.

Every entry default-exports `definePlugin({...})` from `@pear/sdk`. `definePlugin` is an identity function typed for inference, so the exported value is the definition object.

```ts
import { config, definePlugin } from "@pear/sdk";

export default definePlugin({
  id: "my-plugin",
  name: "My plugin",
  description: "Shown in the settings.",
  config: {
    greeting: config.string("Hello", { label: "Greeting" }),
  },
  host: {
    start(ctx) {
      ctx.player.on("trackChange", (track) => ctx.log.info(ctx.config.greeting, track?.title));
    },
  },
  page(ctx) {
    ctx.toast(ctx.config.greeting);
  },
});
```

## The plugin definition

`PluginDef` in `packages/sdk/src/index.ts` is the full shape.

| Field | Type | Purpose |
| --- | --- | --- |
| `id` | `string` | Required. Same as the folder name. `core` is reserved. |
| `name` | `string` | Required. Shown in settings. Translated through `plugins.<id>.name`. |
| `description` | `string` | Shown under the name in settings. |
| `authors` | `string[]` | Metadata. Not rendered by the app. |
| `platforms` | `Platform[]` | `linux`, `win32`, `darwin`. Default: all. Other platforms neither list nor run the plugin. |
| `enabledByDefault` | `boolean \| Platform[]` | Fresh-profile state. Default: off. |
| `restartRequired` | `boolean` | Enabling or disabling applies on the next app start. Also implied by `host.beforeReady` and `host.windowOptions`. |
| `config` | `ConfigShape` | Settings schema, defaults and UI metadata. |
| `actions` | `Record<string, { label, description? }>` | Buttons in the plugin's settings card. Each runs the host command of the same name. |
| `style` | `string \| (config) => string` | CSS applied while the plugin runs. Usually the result of the `css` macro. |
| `host` | `HostPart` | Electron main-process half. |
| `page` | `PagePart` | YTM main-world half. |

Id, name, description, config texts and action labels are translated by the settings catalog using `plugins.<id>.*` keys, with the strings in the definition as English fallbacks. Run `nub run i18n` to add them to `en.json`.

## Host part

`host` runs in Electron's main process.

| Member | Purpose |
| --- | --- |
| `beforeReady(ctx)` | Runs before `app.whenReady()` when the plugin was enabled at launch. For command-line switches and Chromium feature flags. Changes need a restart. |
| `start(ctx)` | Starts the plugin. May return a cleanup function. |
| `onConfigChange(config, ctx)` | Handles a config write without a restart. Return `"restart"` to restart anyway. |
| `windowOptions(config)` | Extra `BrowserWindow` options for the main window. Applied when enabled at launch; changes need a restart. |
| `commands` | Typed functions the page can call with `ctx.host.invoke`. `this` is the host context. |
| `rpc` | Methods other apps call through the API server. Each has a valibot `input` schema and a `run` function. |

Disabling stops the host part; its context's cleanups run and its commands are no longer callable until the plugin is enabled again. A config write is offered to the running part; when the part cannot apply it and has a `start`, the part is restarted rather than reloaded in place.

The `beforeReady` context carries `config`, `app`, `enableFeatures(...names)` and `disableFeatures(...names)`. The features collected from all enabled plugins become one `enable-features` or `disable-features` command-line switch.

`windowOptions` may set frame, transparency and colors. Geometry, visibility and the security-relevant `webPreferences` are enforced by `MainWindow` afterwards, so a plugin cannot weaken the sandbox or the preload.

## Page part

`page` runs in YTM's main world. It is either a function (`start`) or an object:

| Member | Purpose |
| --- | --- |
| `runAt` | `"idle"` (default) waits for DOM ready; `"start"` runs before YTM's own scripts. |
| `start(ctx)` | Starts the plugin. May return a cleanup function. |
| `onConfigChange(config, ctx)` | Handles a config write without a restart. Return `"restart"` to restart anyway. |

A page part is started when its plugin is enabled in the host bootstrap and stopped when the host reports it disabled. With `restartRequired`, a page part starts only if the plugin was enabled when the page loaded and keeps running until the next load; the settings UI shows the restart banner. Without it, enable, disable and config changes apply live. Performance mode skips the page halves of `ambient-mode`, `blur-nav-bar` and `visualizer`; their config and host parts still run.

`runAt: "start"` runs before there is a `<body>`. Use it only to patch page globals before YTM starts, and `ctx.waitFor` for elements later.

## Contexts

Both parts share the common members:

| Member | Purpose |
| --- | --- |
| `id`, `config` | The plugin id and the current config, always fresh. |
| `setConfig(patch)` | Writes a partial config through the host. |
| `onConfigChange(listener)` | Applies a change without restarting. The listener returns `"restart"` to restart anyway. |
| `setTimeout` / `setInterval` / `clearTimeout` / `clearInterval` | Timers cleared when the plugin stops. |
| `onCleanup(fn)` | Runs when the plugin stops, including during a restart or quit. |
| `t(key, english, vars)` | Translation with `{{name}}` interpolation. |
| `log.info` / `warn` / `error` | Console logging prefixed with `[pear:<id>]`. |

Host context adds:

| Member | Purpose |
| --- | --- |
| `app`, `window` | Electron's app and the main window. |
| `session` | The default session, with this plugin's scoped `webRequest`. |
| `webRequest` | Electron's `WebRequest` API, composed fairly with the core and other plugins. Listeners are removed when the plugin stops. |
| `player` | Host player mirror: `state`, `on("change" | "trackChange")`, `control(action)`, `details()`. |
| `request(event, payload?, { timeout? })` | Asks the page part's `ctx.host.handle` and awaits the answer. |
| `emit(event, payload?)` | Sends an event to the page part. |
| `openSettings()`, `focusWindow()` | Opens the settings overlay and focuses the main window. |
| `addMenuItem(item)`, `pluginMenuItems()`, `onMenuItemsChange(fn)` | App and tray menu entries that live with the plugin. |
| `listen(emitter, event, fn)` | `emitter.on` that is removed on stop. |
| `setStatus(text)` | A line on the plugin's settings card; an empty string clears it. |
| `api.broadcast(event, data)` | Sends `PLUGIN_EVENT` to API server WebSocket clients while the server is on. |
| `onProtocol(fn)` | Listens to app-protocol commands (`youtubemusic://...`). |

Page context adds:

| Member | Purpose |
| --- | --- |
| `player` | Page player facade. See [Player API](./player-api.md). |
| `host` | `invoke(command, ...args)`, `on(event, fn)`, `handle(event, fn)`. |
| `sel(name)`, `$`, `$$` | Selector registry lookup and element queries. |
| `waitFor(name, { timeout? })` | Resolves with the first matching element. |
| `mount(element, place)`, `mount(element, parentName, position?)` | Keeps an element in the page across YTM re-renders. |
| `observe(target, options, callback)` | A `MutationObserver` disconnected on stop. |
| `listen(target, type, fn, options?)` | `addEventListener` removed on stop. |
| `audio()` | The shared Web Audio graph. Use it instead of connecting the `<video>` yourself. |
| `addStyle(css)` | Adds a style sheet for the plugin's lifetime; returns `{ update, remove }`. |
| `toast(message)` | Shows a message in YTM's toast. |
| `isWindowVisible()` | Whether the window is on screen; visual loops check this to pause. |
| `signal` | Aborts when the plugin stops. |

Every listener, timer, observer, style, mounted element and audio node registered through these members is undone on stop. That also holds when `start` is still awaiting and the plugin stops meanwhile: anything registered after the stop is undone at once. Page code can check `ctx.signal.aborted` to stop early.

## Config

`config` is a record of fields built with the helpers in `packages/sdk/src/config.ts`:

| Builder | Stored value |
| --- | --- |
| `config.bool(default, meta)` | `boolean` |
| `config.number(default, { min, max, step, unit, variant })` | `number` |
| `config.string(default, { placeholder, secret })` | `string` |
| `config.select(default, options, meta)` | one option's `value` |
| `config.multi(default, options, meta)` | array of option values |
| `config.shortcut(default, meta)` | Electron accelerator string |
| `config.list(default, meta)` | `string[]` |

Every field takes `label`, and optionally `description`, `group`, `restart` and `platforms`. Numbers default to a slider when bounded with at most 1000 steps and to a stepper otherwise. Selects default to chips for up to eight options and to a dropdown otherwise. `secret` renders a password input.

`ConfigOf<typeof schema>` is the inferred config type. `normalizeConfig()` drops unknown keys and resets values that no longer fit the schema to their defaults, so a removed option cannot crash a plugin.

Plugin config is stored as `plugins.<id>` in `<userData>/config.json`, next to the `enabled` flag. `setConfig({ key: value })` writes the changed fields through the host. Arrays are stored as lists and replaced, not merged. A config write is offered to the running part; when the part cannot apply it, the part restarts. `restart: true` on a field only tells the settings UI to show a restart pill; it does not change the plugin lifecycle by itself.

## Communication

Page to host, typed commands:

```ts
host: {
  commands: {
    async save(title: string) {
      await writeFile(join(this.app.getPath("downloads"), `${title}.txt`), title);
      return true;
    },
  },
},
page: async (ctx) => {
  const saved = await ctx.host.invoke("save", "My song");
},
```

Host to page, events:

```ts
// host
ctx.emit("progress", 0.5);
// page
ctx.host.on("progress", (value) => { /* … */ });
```

Host asks the page:

```ts
// page
ctx.host.handle("volume", () => ctx.player.api?.getVolume());
// host
const volume = await ctx.request<number>("volume");
```

Requests time out after 10 seconds by default; `ctx.request` accepts a `timeout`. A missing handler or a stopped page rejects the request. Page events and handlers are removed when the page part stops.

## Actions and RPC

`actions` adds buttons to the plugin's settings card. The settings UI calls `plugin:invoke` with the action name, which runs the host command of the same name:

```ts
actions: {
  reconnect: { label: "Reconnect", description: "Connect again now." },
},
host: {
  commands: {
    reconnect() { /* … */ },
  },
},
```

`host.rpc` exposes methods to other apps through the API server:

```ts
import { v } from "@pear/sdk/rpc";

host: {
  rpc: {
    segments: {
      summary: "Skip segments of a video",
      input: v.object({ videoId: v.string() }),
      run({ videoId }) {
        return fetchSegments(videoId);
      },
    },
  },
},
```

The method becomes `POST /api/v1/plugins/<id>/<method>`. The body is validated against `input` before `run` is called; invalid input gets 400, a disabled plugin gets 503, and an unknown method gets 404. RPC methods of running plugins are listed by `GET /api/v1/plugins` and in `/doc`. Output is sent as JSON; `undefined` produces 204.

## Menus

`ctx.addMenuItem({ label, accelerator?, click })` adds an item under the native Options menu and in the tray menu. The item is removed when the plugin stops. The `tray` plugin draws its own menu from `ctx.pluginMenuItems()` and refreshes on `ctx.onMenuItemsChange`.

There is no per-plugin native submenu and no `menu` half. Complex controls belong in the plugin's settings card or in the page.

## Styles

`style` is CSS applied for the plugin's lifetime, before themes in the cascade. The `css` macro validates and minifies it at build time and resolves selector names:

```ts
import { css } from "@pear/sdk/macros" with { type: "macro" };

style: css`
  sel(nav_bar) {
    backdrop-filter: blur(8px);
  }
`,
```

`sel(name)` becomes the registry selector. A selector present in both player-bar layouts becomes `:is(...)`, so one rule covers both. Unknown selector names fail the build. The macro does not accept `${}` interpolation; use CSS variables for values that change. `style` may be a function of the config.

For CSS outside `style`, use `ctx.addStyle(css)`. It also works at document start and returns a handle whose `update()` replaces the CSS.

## Build splitting

One plugin file contains both halves. The build rewrites a `?pear=host` copy by removing `page` and `style`, and a `?pear=page` copy by removing `host`, then prunes imports and local declarations no longer referenced. That is how a single file can import `node:fs` or Electron in its host part without breaking the page bundle.

Consequences:

- Code outside `host` and `page` runs in both bundles. A top-level `new Tray(icon)` breaks the page; put it in `host.start`.
- Keep host-only imports referenced from host code only. A type-only import that survives type stripping can keep a host class in the page; the splitter prunes what is no longer used after type stripping, but a runtime reference in shared top-level code is still shared.
- `page` parts receive no preload half. Anything that must run before YTM's scripts belongs in `runAt: "start"`, after which the same context is available.
- A plugin without a `page` part contributes nothing to the page bundle except the parts referenced by shared top-level code.

## Translations

`ctx.t(key, english, vars)` returns the active language's text, the English fallback, or the key. Keys added by literal `ctx.t("plugins.my-plugin.x", "English")` calls are picked up by `nub run i18n`; computed keys are not, so write the key out in full. The settings texts generated from the config schema are added automatically.

## Shipped plugins

The tree ships the upstream plugin set plus the fork's additions. The fork-specific plugins are `always-show-volume-slider`, `audio-only`, `dismiss-multidevice-popup`, `fullscreen-auto-hide`, `memory-saver`, `no-google-login`, `playback-recovery`, `playlist-search`, `prefer-song`, `search-commands`, `seek-shortcuts`, `sfw-music`, `skip-ai-slop`, `statusbar-lyrics` and `toast-autoclose`. Larger examples to read: `plugins/downloader` (host commands, page UI, RPC), `plugins/equalizer` (shared audio graph), `plugins/visualizer` (audio taps and performance-mode skipping) and `plugins/synced-lyrics` (Preact UI, RPC and translation).

## Tests

Put plugin unit tests in `plugins/<id>/test/` and run them with `nub run test`. Plugin package manifests need a `test` script (`vitest run`) for the workspace run to pick them up. E2E tests live in `apps/desktop/e2e/`; see [Creating a plugin](./creating.md#testing).

## Where to go next

- [Creating a plugin](./creating.md): build one step by step.
- [Modifying plugins](./modifying.md): add options, commands, migrations and tests.
- [Using plugins](./using.md): enable, configure and troubleshoot.
- [Player API](./player-api.md): tracks, actions, queue helpers and song details.
- [Porting from upstream](./porting-from-upstream.md): map pear-desktop 3.x plugins onto this API.
- [Conventions](../conventions.md): translations, naming, tests and releases.
