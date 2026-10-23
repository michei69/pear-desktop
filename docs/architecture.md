# Architecture

The repository is a pnpm workspace. The app in `apps/desktop` builds the Electron main process and the preload script and ships two page bundles: the YTM runtime and the standalone settings app. Shared code lives in `packages/`, one workspace package per plugin lives in `plugins/`, and translations live in `src/i18n/resources`.

## Process model

| Surface | Entry point | Role |
| --- | --- | --- |
| Main process | `apps/desktop/src/main/index.ts` | Wires the window, menu, protocol, config, themes, API server and host plugin parts together |
| Preload | `apps/desktop/src/preload/index.ts` | Exposes `window.__pear` on YTM and the settings window, and runs the page runtime in YTM's main world |
| Page runtime | `packages/page/src/index.ts` | Boots the player facade, page plugin runner, appearance tweaks and theme application inside YTM |
| Standalone settings | `packages/ui/src/standalone.tsx` served at `pear://settings` | The same settings UI as the in-page overlay, without YTM |

The renderer is a single sandboxed, context-isolated window per surface. `secureWebPreferences()` in `apps/desktop/src/main/windows.ts` sets `preload`, `contextIsolation: true` and `sandbox: true`. There is no Node access in the page; everything privileged goes through the preload bridge.

## Boot sequence

Main process (`apps/desktop/src/main/index.ts`):

1. `setAppIdentity()` pins `userData` (or `PEAR_USER_DATA` for tests), names the app with `APP_ID`, sets the X11 window class and the Windows AppUserModelId, so an existing pear-desktop install keeps its data folder and taskbar entry. The single-instance lock follows.
2. `new Settings(userData, hostPlugins, app.getVersion())` reads and migrates `config.json` before anything else touches it.
3. `new PluginHost(...)` filters plugins by platform and creates the plugin registry.
4. `beforeReady()` in `startup-tasks.ts` applies `advanced.disableHardwareAcceleration` or the opt-in `advanced.inProcessGpu`, registers the privileged `pear` scheme, runs every enabled plugin's `host.beforeReady`, disables Chromium's media session when `advanced.forceSmtc` is on for Windows, and appends the collected Chromium feature switches.
5. `whenReady`: `hardenSession()` installs the permission handlers, load i18n with `loadI18n(resolveLanguage(...))` and give it to the plugin host, build the language sync callbacks, install the core `WebRequest` listeners through `setupNet()`, serve the settings window, register `ipcMain` handlers, start the theme engine (`CoreOptions.start()`), build the native menu, seed Google's consent cookie, apply the configured proxy, create the main window, start Windows SMTC when `forceSmtc` is on, create the update manager and the API server, then `plugins.attach()` starts the host parts that are enabled.
6. After attach: register the `youtubemusic://` protocol handler, apply window options, apply the API server config, open the settings window when `--settings` is on the command line, and schedule the delayed cache clear and update check.
7. `before-quit` stops SMTC, the update manager, the theme poller, the API server and all host plugin instances, then flushes the config file.

Preload (`apps/desktop/src/preload/index.ts`):

1. On YTM and on `pear://settings` it requests a bootstrap synchronously with `ipcRenderer.sendSync(CHANNEL.bootstrap)` and exposes `window.__pear` with the bootstrap, `invoke(name, ...args)` and `onEvent(listener)`.
2. On YTM it also exposes `window.pearPerf` (`getResourceUsage`, `clearCache`) for the memory saver, and executes the page runtime string in the main world with `contextBridge.executeInMainWorld`. Other origins, including Google sign-in, are left untouched.

Page runtime (`packages/page/src/index.ts`) runs before YTM's own scripts:

1. Reads the bridge, applies the `site` overrides by wrapping `ytcfg.set` before YTM reads its experiment flags, and creates the player facade with the page's `appearance` config.
2. Creates the plugin runner with the host bootstrap, applies appearance tweaks, applies the theme state, and mounts the settings UI after DOM ready.
3. Subscribes to host events: plugin state, plugin events, errors, status lines, host requests, core state, themes, window visibility, player control and UI actions.
4. Registers the page side of the API server (queue, search, likes, fullscreen, details) and starts the enabled page parts.

Standalone settings (`pear://settings`):

- `registerSettingsScheme()` must run before `app.whenReady()`; `serveSettings()` serves a fixed HTML document and the bundled `app.js`.
- `packages/ui/src/standalone.tsx` renders the dialog over the bridge with `bridgeModel`, so plugins and core settings stay reachable when YTM does not load.
- The preload exposes the bridge on `SETTINGS_ORIGIN`; no page runtime is injected there.
- `--settings` opens it, also from a second instance. `openSettings()` from the menu, `Ctrl/Cmd+,` or the sidebar entry prefers the in-page overlay and falls back to this window when the runtime is not up.

## Build

`apps/desktop/electron.vite.config.ts` uses `electron-vite` and the `@pear/vite-plugin` plugin. It produces `out/main/index.js`, `out/preload/index.cjs` (CommonJS because sandboxed preloads require it) and the page bundles embedded as strings. `json.namedExports: false` keeps translation dynamic imports working, and `@michei69/node-smtc` stays external because it is a Windows-only optional native module.

The Vite plugin (`packages/vite-plugin-pear/src/index.ts`) generates four virtual modules:

- `virtual:pear/host-plugins`: every `plugins/<id>/index.ts` or `index.tsx`, imported through a `?pear=host` split id for the main process.
- `virtual:pear/page-runtime`: the page entry plus every plugin split for the page, bundled with Rolldown into one self-contained IIFE string.
- `virtual:pear/settings-app`: the same treatment for `@pear/ui/standalone`.
- `virtual:pear/i18n`: the language codes, their metadata, and one dynamic import per resource file, so a bundle carries only the languages it loads.

`packages/vite-plugin-pear/src/split.ts` removes the `page` and `style` properties for the host bundle and the `host` property for the page bundle, then prunes imports and local declarations that are no longer referenced. Both halves therefore live in one file, but `node:`, Electron and native imports never reach the page. `PEAR_ONLY_PLUGINS=a,b` limits discovery for focused tests.

Build metadata is baked into the main bundle by `electron.vite.config.ts`: `__PEAR_CHANNEL__` comes from `PEAR_CHANNEL` (default `dev`) and `__PEAR_COMMIT__` from `PEAR_COMMIT` or the local short commit. `apps/desktop/src/main/app-info.ts` turns those into the About label and copyright block; `general.updateChannel` (`stable` or `beta`) chooses the release line and a beta build starts on `beta` until the user picks one. `UpdateManager` in `updates.ts` checks GitHub shortly after startup and every six hours while `general.autoUpdates` is on, and rechecks when the channel changes. The dialog opens the release page or disables further checks. A beta build switching to stable asks for confirmation first, because downgrading runs no migrations back.

`apps/desktop/electron-builder.yml` packages `out/**` only: the app is self-contained, so no `node_modules` ship. `extraFiles` adds the license, and `extraResources` ships ffmpeg.wasm's core for the downloader. `electronLanguages` trims Chromium's locale packs to the languages present in `src/i18n/resources` plus the regional spellings electron-builder needs. Linux targets are AppImage, Flatpak, deb, rpm, snap, freebsd and tar.gz; Flatpak uses runtime and base `26.08`. Output goes to `pack/` (`directories.output`), and the `dist:*`, `beta:*` and `release:*` scripts pass `-p never`, so CI owns publishing. Release details are in [Conventions](./conventions.md#releases-and-ci).

## Configuration and migrations

Settings are stored in `<userData>/config.json` by `apps/desktop/src/main/config.ts`, without `electron-store` at runtime:

- `plugins.<id>` holds `{ enabled, ...config }`. The API server is stored as `plugins.api-server`, where pear-desktop kept it.
- `options.*` holds the core sections `general`, `window`, `appearance`, `advanced` and `site`, plus the theme keys `theme`, `themePresets`, `themeOverrides`, `themeConsent` and `themesSeeded`, and the legacy `themes` CSS list until it is migrated.
- `url`, `window-size`, `window-position` and `window-maximized` hold the last page and window state.
- `__internal__.migrations.version` records the version that last wrote the file.

Values are normalized against their schema on load: unknown keys are kept, invalid values fall back to defaults. Writes are debounced by 300 ms and go through a temporary file plus rename. A damaged file is copied to `config.json.damaged-<timestamp>` before defaults replace it. `flush()` writes pending changes on quit.

Core section schemas live in `packages/sdk/src/core-config.ts`, plugin schemas in each plugin. `normalizeConfig()` in `packages/sdk/src/config.ts` enforces types, options and list contents.

Migrations run in `apps/desktop/src/main/migrations/index.ts`. Each entry is a version and a function; it runs when the stored version is older and the app version has reached it, records the new version at once, and never runs twice. The `4.0.0` migration keeps plugin ids and option names, moves the tray app option onto the tray plugin, gives existing users the API server's old `0.0.0.0` default, keeps `performance-improvement` on where it was on, and converts plugin options in `migrations/plugins.ts`. Unknown keys and old plugin keys stay in the file so a downgrade still finds them. Files a migration creates (for example moved picture-in-picture window bounds) are written next to `config.json` only when missing.

## Plugin runtime

`apps/desktop/src/main/plugins.ts` owns host parts. `packages/page/src/plugins.ts` owns page parts. Both implement the same lifecycle contract:

- A plugin is one `definePlugin({...})` object with optional `host` and `page` parts.
- Enabling starts a part; disabling stops it and runs everything it registered through the context.
- A config write is offered to a running `onConfigChange` listener, or to the part's `onConfigChange`; when neither exists and the part has `start`, the part is restarted. Host commands stay callable while the host instance exists.
- `restartRequired` (also implied by `host.beforeReady` or `host.windowOptions`) means the page part starts only when the plugin was enabled at page load and keeps running until the next load. The settings UI shows a restart pill and collects pending restarts in a banner.
- `enabledByDefault`, `platforms` and `supportsPlatform` decide the starting state and visibility. There are no essential plugins in this tree.

Communication crosses the preload bridge as protocol events (`packages/sdk/src/protocol.ts`):

- Main to page: `plugin-state`, `plugin-event`, `plugin-error`, `plugin-status`, `plugin-request`, `core-state`, `themes`, `window-visibility`, `player-control`, `ui`.
- Page to main: `bridge.invoke()` commands such as `plugin:set-enabled`, `plugin:set-config`, `plugin:invoke`, `plugin:respond`, `core:set-config`, `theme:*`, `app:relaunch`, `app:show-settings-file`, `app:toggle-devtools` and `player:update`.
- `ipc.ts` validates the sender frame: only top-level YTM or settings frames may invoke, and `plugin:respond` and `player:update` are accepted only from YTM.

Host and page parts talk to each other through typed host commands (`ctx.host.invoke`), host events (`ctx.emit` / `ctx.host.on`), host requests (`ctx.request` / `ctx.host.handle`) and, for plugins exposed to other apps, API server RPC methods. Details are in [Plugins](./plugins/index.md).

## Player and details

`packages/page/src/player.ts` is the only code that touches YTM's `#movie_player` API and media element. It polls for the API after the element exists, owns `NowPlaying`, maps player actions to the page's own buttons or API calls, and publishes state to the host. Position-only updates are batched to at most one per second; everything else is sent immediately.

`apps/desktop/src/main/player.ts` mirrors that state for host plugins, the tray, SMTC, MPRIS, notifications and the API server. `HostPlayer.details()` asks the page for extra metadata (`SongDetails`: views, tags, upload date, alternative title, artist URL) through `PageRequests`; a page that is not up yields `null`.

## Settings UI

`packages/ui` is a Preact app shared by the in-page overlay and the standalone window:

- The dialog has a searchable sidebar with General, Appearance, Window & Tray, Advanced, Developer Tweaks, Plugins and About sections, built from `packages/ui/src/settings/sections.ts`.
- Core sections render from `CORE_SECTIONS` in `packages/sdk/src/core-config.ts`. Plugin cards render from the plugin's config schema and its `actions`.
- Each field kind has one control in `packages/ui/src/fields.tsx`: switch, slider or stepper, text, chips or dropdown, shortcut recorder, string list and multi-select. Label, description, placeholders, options and group headings come from translation keys generated by `apps/desktop/scripts/i18n.ts`.
- Plugin cards show host errors, the host's status line (`ctx.setStatus`), action buttons and a restart pill. Pending restarts collect in a banner with "Restart now" and "Later"; the relaunch command is `app:relaunch`.
- The overlay opens from the sidebar entry, `Ctrl/Cmd+,` or the native menu. It renders into a shadow root and stops page shortcuts while open. The standalone window uses the same components with `standalone`.

## Themes

The theme engine is host-owned and page-applied:

- `apps/desktop/src/main/theme-load.ts` reads `<userData>/themes/<id>/theme.json`, concatenates declared CSS files, and hashes a declared script with SHA-256.
- `apps/desktop/src/main/themes.ts` seeds and upgrades the Basic theme, migrates `options.themes`, polls the folders every second, gates scripts behind per-theme consent, resolves palette layers and serves `ThemeState`.
- `packages/page/src/themes.ts` applies the selected theme with constructed style sheets: theme CSS, then the resolved `--pear-theme-*` palette, then any palette a script adds. It mounts a consented script and tears it down when the theme or its hash changes.
- Menu and settings share the same host methods: select, allow script, set preset, edit a palette value, reset the palette, import CSS files and open the folder.

Details are in [Themes](./themes/index.md) and [Theme engine internals](./themes/internals.md).

## I18n

Translations are JSON files in `src/i18n/resources/<code>.json`. Each starts with a `language` metadata block (`code`, `name`, `local-name`). The Vite plugin turns every file into its own dynamic import; the main process loads English plus the active language, flattens both to dotted keys, drops empty Weblate entries and builds the `t` function in `packages/sdk/src/i18n.ts`.

`loadI18n()` in `apps/desktop/src/main/i18n.ts` resolves the configured language, then the system locale through its prefixes, then English. The resulting strings travel to the page in the bootstrap, so the runtime needs no language loader. `ctx.t(key, english, vars)` uses them and interpolates `{{name}}` placeholders; `applicationName` is filled automatically.

`apps/desktop/src/main/language-sync.ts` maps the app languages to YTM's `PREF` cookie `hl` values and back, including the exceptions (`pt`/`pt-BR`, `nb`/`no`, `be-Latn`, `zh-HK`, and languages YTM does not have). The Language setting carries a sync control, and **Options ▸ Language ▸ Sync language** offers **From YouTube** (reads `hl`, stores it as the app language, applies after a restart) and **To YouTube** (writes `hl` and reloads the page).

## API server

`apps/desktop/src/main/api/` is a local HTTP(S) and WebSocket server controlled by the `apiServer` core section. It is off by default and binds `127.0.0.1:26538`.

- v1 routes are in `routes.ts`: song and queue reads, playback and seek controls, like/dislike, shuffle, repeat, volume, mute, fullscreen, search, queue add/move/remove/play/clear, and `POST /api/v1/plugins/<id>/<method>` for plugin RPC. `/auth/{id}` issues a token.
- v2 routes are in `v2.ts`, backed by the shared `operations.ts`: `/api/v2/video` (unified song info), video play/next/prev/search/download, `/api/v2/browse`, lyrics read and translation, playback state/speed/position/play/pause/shuffle/repeat, volume and mute, rating, queue read/add/move/remove/select/clear/autoplay, `/api/v2/pear` (app and hardware info), `/api/v2/pear/config` (GET and PATCH), and feature flag read/patch/delete.
- `server.ts` adds CORS, bearer-token checks, JSON body limits, `/doc` (OpenAPI 3.1 with v1, v2 and plugin RPC) and `/swagger`. WebSocket clients connect to `/api/v1/ws?token=...` or `/api/v2/ws?token=...`. v1 receives `PLAYER_INFO`, `VIDEO_CHANGED`, `PLAYER_STATE_CHANGED`, `POSITION_CHANGED`, `VOLUME_CHANGED`, `REPEAT_CHANGED`, `SHUFFLE_CHANGED` and `PLUGIN_EVENT`; v2 adds `RATING_CHANGED`, `LYRICS_CHANGED` and `TRANSLATION_UPDATED` (the lyrics events come from the v2 lyrics and translation routes), and accepts v2 commands (`NEXT_VIDEO`, `PREV_VIDEO`, `PLAYBACK` with status/speed/position/shuffle/repeat/volume/mute, and `RATE`).
- The MCP endpoint is `/mcp`: stateless Streamable HTTP with JSON responses, gated by `mcpEnabled`, authenticated with the same bearer token, and exposing the v2 operations as tools such as `video`, `search`, `browse`, `lyrics`, playback, volume, rating, queue and config tools. `GET` and `DELETE` return 405 because no session is kept; unknown tool calls return a JSON-RPC error. Plugin RPC stays on v1.
- Tokens are HS256 JWTs signed with the configured `secret`, which is generated when empty. The first client is authorized through a dialog when `authStrategy` is `AUTH_AT_FIRST`; authorized ids are stored in `authorizedClients` and can be removed in settings. `useHttps` with a certificate and key serves HTTPS.

## Links, protocol and permissions

- `apps/desktop/src/main/links.ts` is pure routing policy. YTM, the video site and Google stay in the app, OAuth and help popups open in a child window that follows the same routing, and other web pages open in the browser. `mailto:` and `tel:` go to the system handler; other schemes and non-web URLs are denied. `main-window.ts` applies the policy to `will-navigate`, `will-redirect`, `setWindowOpenHandler` and popup windows. Google sign-in gets Electron's honest user agent, YTM gets a Chrome one.
- `apps/desktop/src/main/protocol.ts` handles `youtubemusic://` links (playback commands from notification buttons, scripts or other apps), including links passed to a second instance. Playback commands are applied first, then `ctx.onProtocol` listeners hear them. The handler is registered only in packaged builds.
- `apps/desktop/src/main/permissions.ts` allows only media capture, sanitized clipboard writes, fullscreen and `mediaKeySystem`, denies everything else, and disables spellcheck.
- `apps/desktop/src/main/net.ts` strips `content-security-policy` and `content-security-policy-report-only` from YTM responses, because YTM's CSP and Trusted Types would block the injected runtime, and sends the Electron user agent to `accounts.google.com`. Plugins compose their listeners through `WebRequestRouter` (`web-request.ts`), which installs one real listener per Electron event so an ad blocker, a proxy and the core do not replace each other.
- `seedConsent()` writes Google's essential-only `SOCS` cookie when none exists, so the consent interstitial does not block startup.

## Shared-link cleaning

`packages/sdk/src/share-url.ts` holds the link cleanup helpers: `stripMusicSubdomain()` removes the `music.` host, `stripSIParam()` removes YouTube's `si` tracking parameter while keeping the query valid, and `createShareUrlRewriter(document, options)` watches YTM's `#share-url` input and rewrites it before the user copies. The page runtime applies the rewriter after DOM ready with `appearance.stripMusicFromSharedLinks` and `stripSIFromSharedLinks`, and reconfigures it when that section changes. **Navigation ▸ Copy current URL** uses the same two functions on the current page URL.

## Performance

`advanced.performanceMode` is a restart-only core option that `packages/page/src/performance.ts` reads once at page start:

- It forces cheaper YTM feature flags (artwork thumbnails, Lottie/Rive animations, watch cinematics, queue and icon rendering); the user's own `site.siteFlags` overrides still win.
- It injects a stylesheet that collapses animations and transitions, removes backdrop filters and disables layer hints, and installs a Web Animations throttle that collapses animations touching non-composited layout properties.
- It skips the page halves of `ambient-mode`, `blur-nav-bar` and `visualizer`; their config and host parts are untouched, so turning the mode off restores them.

Other performance work:

- `advanced.inProcessGpu` folds the GPU service into the app process (`in-process-gpu`), and is ignored when hardware acceleration is disabled. `advanced.disableHardwareAcceleration`, `advanced.autoResetAppCache` (clears the session cache 20 seconds after startup) and `general.autoUpdates` are core options.
- `plugins/performance-improvement` injects CY Fung's timer and element-reuse scripts at page start. It is `restartRequired`, because replacing page globals cannot be undone live.
- `plugins/memory-saver` polls Blink's resource usage every minute while the window is hidden and clears the renderer caches above its threshold, with a ten-minute cooldown. It uses `window.pearPerf` from the preload.
- Visual plugins pause their drawing with `ctx.isWindowVisible()`, because the window keeps rendering while minimized or hidden (`backgroundThrottling: false`).

On Windows, `advanced.forceSmtc` disables Chromium's media session and starts `smtc.ts`, which drives the native System Media Transport Controls through the optional `@michei69/node-smtc` module. MPRIS on Linux and the Touch Bar plugin remain separate integrations.

## Tests

Vitest covers pure modules and plugin logic; Playwright drives the built app. The commands, locations and conventions are in [Conventions](./conventions.md#tests).
