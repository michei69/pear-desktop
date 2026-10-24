# Using plugins

This page is for people who use Pear Desktop: turning plugins on and off, changing their settings and understanding restart prompts. Writing plugins is covered in [Creating a plugin](./creating.md) and [Modifying plugins](./modifying.md).

## Plugins are part of the app

Every plugin is compiled in at build time. There is no plugin store, no plugin folder to drop files into and no supported way to install a third-party plugin. The list is fixed by `plugins/` and changes when the app is rebuilt. If a plugin you want is missing, it has to be added to the source.

Themes are different: a theme is a folder under the user themes directory and can be installed without rebuilding. See [Themes](../themes/index.md).

## Opening settings

- Select **Settings** at the end of YTM's sidebar.
- Press `Ctrl+,` (`Cmd+,` on macOS).
- Use the native menu: **Options ▸ Settings…**, or the app menu on macOS.
- Start the app with `--settings` to open the standalone settings window.

The page overlay is used when YTM's page runtime is up. When it is not, the app opens the standalone `pear://settings` window, which has the same sections and works without YTM. The window can also be opened from a second instance started with `--settings`.

The sidebar has General, Appearance, Window & Tray, Advanced, Developer Tweaks, Plugins and About. The search box filters sections, plugin names and setting labels across all of them.

**General** holds the language and update settings. **Language** offers **From YouTube** (copy YTM's `hl` language into the app, applied after a restart) and **To YouTube** (point YTM at the app language and reload the page). **Update channel** selects stable or beta; a beta build starts on beta until you choose, and switching a beta build to stable asks first because a downgrade runs no migrations back.

## The Plugins section

Each plugin is a card with a toggle, its description and, when it has any, expandable settings:

- The toggle enables or disables it immediately. The page and main-process parts start or stop without an app restart.
- A plugin with a **restart** pill cannot fully change state live. The host part starts or stops at once, but the page part changes on the next page load or app start.
- The card shows the plugin's error in red when its start failed, and a status line when it reports one (for example a download or connection progress).
- Settings buttons, when present, run the plugin's commands and show their errors under the buttons.
- A plugin that cannot be configured has no expander and a disabled name row.

Only plugins for the current platform are listed. A plugin enabled by default is on in a fresh profile; you can still turn it off.

## Settings fields

Fields come from the plugin's schema and can be:

- switches,
- sliders or number steppers, sometimes with a unit,
- text inputs, including password inputs for secrets,
- select chips or dropdowns,
- shortcut recorders,
- lists of paths, URLs or ids that you add and remove,
- multi-select option chips.

Changes are written as you make them. A **restart** pill next to a field means the value is only read at startup. Pending restarts collect in a banner at the top of the dialog: **Restart now** restarts the app, **Later** dismisses the banner until another change is flagged. Reopening the dialog in the same window keeps the pending list.

Some plugins apply a config change without restarting; others restart their own host or page part in the background. You do not need to do anything for that.

## Where settings are stored

Settings live in `<userData>/config.json`. Plugin state is under `plugins.<id>`, for example `plugins.ambient-mode`. `<userData>` is Electron's per-user data directory; the app keeps pear-desktop's identity, so an existing install uses the same folder.

- The **Show config.json** button in the About section opens the file in the system file manager. **Options ▸ Edit config.json** opens it directly.
- `plugins.<id>.enabled` is the on/off state. You can disable a plugin by editing the file while the app is closed.
- Missing keys use the plugin's defaults. Removing a key restores its default; removing a whole plugin entry resets the plugin to its defaults.
- Values are validated on load. An invalid value falls back to its default instead of crashing the app.
- Credentials such as scrobbler tokens, API keys and the API server's secret and authorized clients are stored as plain text in this file. Treat it as sensitive and keep it out of bug reports. The About section's debug copy lists versions, platform and enabled plugin names, not tokens.
- Back up the file before editing it by hand. A broken file is kept as `config.json.damaged-<timestamp>` and the app starts from defaults, but recovering the old values by hand is easier with a backup.

## Restarting and reloading

- **Navigation ▸ Restart App** restarts the app. The restart banner uses the same path.
- **View ▸ Reload** reloads the page. It restarts the page parts and reapplies page settings, but not the main-process host parts. A plugin whose host part changed state needs a full restart.

## Plugin errors

When a plugin fails to start, the app keeps running and the plugin stays enabled, with the error on its card:

- The main process logs at `[pear:<id>]` and the page logs at `[pear:<id>]`. Open DevTools with **Options ▸ Toggle DevTools** or `Ctrl+Shift+I`.
- A failed page part says `failed to start`; a failed host part says `failed to start` and appears in the plugin's card through the host error event.
- Disable the plugin from its card. If the settings overlay itself is affected, quit the app and set `"enabled": false` under `plugins.<id>` in `config.json`, then start it again.
- A plugin that reports a missing page handler means its page part is not running, usually because the plugin is disabled, not supported on the platform, or `restartRequired` and not enabled when the page loaded.

Plugins write their logs with a `[pear:<id>]` prefix; the core writes `[pear]` and `[pear:api]`.

## Performance settings and plugins

**Advanced ▸ Performance mode** trades visual fidelity for cheaper rendering. It is read at page start, so it needs a restart. It forces cheaper YTM feature flags (thumbnail quality, animations, cinematics, queue rendering), removes animations, transitions and backdrop blur, throttles Web Animations that touch layout properties, and skips the page halves of **Ambient mode**, **Blur navigation bar** and **Visualizer**. Their settings and main-process parts stay intact, and turning the mode off restores them.

- **Run the GPU process in the app process** is an experimental option that folds the GPU service into the app process. It is ignored when hardware acceleration is disabled.
- **Use Windows media controls** replaces Chromium's media session with the native System Media Transport Controls on Windows. If the optional native module cannot load, the app logs a warning and keeps running without native transport controls.
- **Memory saver** checks Blink's resource usage every minute while the window is hidden and clears the renderer caches when they exceed its threshold (64 MB by default). A clear has a ten-minute cooldown. It never runs while the window is visible.
- **Performance improvement** replaces page timers and element creation with CY Fung's batching scripts at page start. It cannot be undone live, so it is marked `restartRequired`: enable it and restart.
- Visual plugins (ambient mode, visualizer, lyrics) stop drawing when the window is hidden or minimized, because the page keeps rendering off screen.

**Appearance** also has **Shared links** switches: **Strip 'music.' from shared links** and **Strip 'si' from shared links** rewrite the share dialog's URL before it is copied, and **Navigation ▸ Copy current URL** applies the same cleaning.

## The API server

**Advanced ▸ API server** controls a local HTTP and WebSocket server for other apps. It is off by default and binds `127.0.0.1:26538`. When enabled, the card shows the address, the authorization strategy and the authorized clients. A new client triggers an allow/deny dialog unless you choose **None** as the strategy. v1 serves the original client surface and plugin methods at `/api/v1/plugins`; v2 serves the richer video, queue, playback, lyrics, config and debug surface under `/api/v2`; WebSockets are at `/api/v1/ws` and `/api/v2/ws`. **Enable MCP** adds a stateless Model Context Protocol endpoint at `/mcp` with the v2 operations as tools, using the same bearer token.

## See also

- [Plugins overview](./index.md): the system reference.
- [Creating a plugin](./creating.md): write one from scratch.
- [Themes](../themes/index.md): user-installable themes.
- [Conventions](../conventions.md): how changes to the app are made.
