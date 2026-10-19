# Using plugins

> [!NOTE]  
> This might be inaccurate! TODO: look over it entirely

This page is for people who use Pear Desktop and want to turn plugins on or off,
change their settings, and understand the restart prompts. It describes the app
as it behaves today; writing or changing a plugin is covered in [Creating a
plugin](./creating.md) and [Modifying plugins](./modifying.md).

## Plugins are part of the app

Every plugin in the app is compiled in at build time. There is no plugin store,
no plugin folder you can drop files into, and no supported way to install a
third-party plugin: the list of plugins is fixed by the source under
`src/plugins/` and only changes when the app is rebuilt. If a plugin you want is
missing, it has to be added to the source and the app rebuilt.

Themes work differently: a theme is a folder you can install under the user
themes directory. See [Themes](../themes/index.md).

## Two places to manage plugins

The same plugin state is shown in two places, and both write the same config.

### The Plugins menu

The native menu bar has a **Plugins** menu listing every plugin available on
your platform, sorted by name. Each entry is a checkbox:

- Disabled plugin: clicking the entry enables it.
- Enabled plugin with menu options: the entry opens a submenu with an
  **Enabled** checkbox, a separator, and the plugin's own entries (for example
  volume, quality or mode choices).
- Enabled plugin without menu options: the entry itself is the checkbox.

A plugin introduced in the release line you are running carries a **NEW**
sublabel in this menu. If the menu bar is hidden (Options → Hide Menu), the
Plugins menu is hidden with it; use Settings instead.

### Settings → Plugins

Open Settings from the **Settings** entry in YouTube Music's sidebar, from
Navigation → Open Settings, or with the search command `/settings` when the
Search Commands plugin is enabled. The Settings entry in the sidebar can be
switched off, and Settings can be set to always open in a separate window, in
the Settings UI plugin's card under Settings → Plugins.

The **Plugins** section of Settings shows one card per plugin with a toggle and,
for plugins that have them, expandable settings. The plugin toggle here does the
same thing as the Plugins menu entry. A plugin that is always on has no toggle,
but its settings are still shown. The section header counts enabled plugins out
of the total available on your platform.

## Enabling and disabling plugins

Toggling a plugin starts or stops it without restarting the app. Backend,
preload and renderer halves are started or stopped in their own processes, and a
plugin's custom menu entries are added or removed as the native menu is rebuilt.

Some plugins cannot fully apply a toggle live. Those show a **restart** pill on
their card, and the app shows a **Restart Required** dialog after the change:

- **Restart Now** restarts the app immediately.
- **Later** keeps the toggle but leaves the change partial until you restart.

The dialog names the plugin when one plugin is involved, and summarises the
changes when several are pending. Settings changes for options that are only
read at startup show the same pill next to the field and the same dialog; while
the Settings window is open the requirements are collected and reported when it
closes.

If **Options → Advanced Options → Restart on config changes** is enabled, app
options and plugin toggles restart the app immediately instead of showing the
dialog. It is off by default.

## Per-plugin settings

Expand a plugin's card to see its settings. Fields come from the plugin's
declared schema and can be switches, radio chips or dropdowns, sliders, number
steppers, text inputs, multi-select lists, orderable lists, file or folder
buttons, and custom controls supplied by the plugin. Dropdowns whose options are
loaded at runtime (for example the output-device list) have a refresh button and
re-read themselves when the stored value is missing. Lists that cannot change at
runtime, such as the theme list, are refreshed by the app instead.

Settings are applied as you change them. A restart pill on a field means that
option is only read at startup, so it needs a restart; plugin cards show the same
pill when enabling or disabling the plugin needs one.

## Where settings are stored

Plugin settings live in the app's config file, `<userData>/config.json`, under
`plugins.<plugin-id>` (for example `plugins.ambient-mode`). `<userData>` is
Electron's per-user data directory; the exact path depends on the OS and build.
Two menu entries open the file for editing: **Edit config.json** in the Settings
sidebar and **Options → Advanced Options → Edit config.json**.

- The plugin's defaults live in the source. A plugin with no stored entry uses
  them as-is; removing a key from the file restores its default, and removing a
  whole `plugins.<id>` object resets that plugin to its defaults.
- `plugins.<id>.enabled` is the on/off state, so a plugin can also be disabled by
  editing the file while the app is closed.
- Plugin settings that hold credentials (Last.fm and ListenBrainz tokens,
  translation API keys, the API server's secret and authorized clients) end up
  as plain text in this file. Treat it as sensitive, and do not share it in bug
  reports; the About section's debug copy contains environment details, feature
  flags and enabled plugin names, not those tokens.

Back up the file before editing it by hand. A JSON syntax error can make the
whole store fail to load, not only the key you were changing.

## Essential and platform-restricted plugins

- **Essential plugins** are always running and cannot be disabled. The Settings
  UI plugin is the only essential one in this fork; it is what renders the
  settings window and the sidebar entry, so it has no toggle.
- **Platform-restricted plugins** only exist on the OS they support. Examples:
  Touch Bar and Status Bar Lyrics are macOS-only, and Taskbar Media Control is
  Windows-only. On other systems the plugin does not appear in the menu or in
  Settings. Platform restrictions also apply to individual settings fields, so a
  card can show fewer fields on one OS, as with In-App Menu's Linux-only
  window-controls option.

## The NEW badge

A plugin's entry in the Plugins menu shows **NEW** while the running app's
version satisfies the plugin's `addedVersion` range (for example `3.12.X`). The
badge is informational: it disappears once the app moves past that release line,
and it is only shown in the native menu, not on the Settings cards.

## Performance mode

**Settings → Advanced**, in the *Performance* group, has **Performance mode**,
which trades some visual fidelity for cheaper rendering. It affects plugins in
two ways:

- The renderer halves of `ambient-mode`, `blur-nav-bar` and `visualizer` are not
  started while the mode is on. Their menus and settings stay available, and
  their saved settings are left untouched, so turning the mode off brings them
  back.
- The mode also applies feature-flag overrides, a CSS pass that shortens
  animations and transitions, and a Web Animations throttle. Those parts are app
  behaviour rather than plugin toggles.

Performance mode is read when the app starts, so the setting has a restart pill:
restart for it to take effect. For bisecting a performance problem there is a
developer escape hatch, `PEAR_PERF_DISABLE=flags,css,animations,plugins`, which
turns individual parts off while leaving the mode enabled.

## Troubleshooting

- **A plugin does not seem to load.** Open the developer tools (Options →
  Advanced Options → Toggle Developer Tools) and check the console for
  `[YTMusic]` lines. A failed start logs
  `Failed to execute plugin <id>::<half>` or `Failed to initialize plugin
  "<id>"`; the app keeps running and the plugin stays enabled, so you can disable
  it and try again.
- **A setting has no effect.** Check for a restart pill on the field or the
  plugin card. Some options are read only at startup.
- **A plugin breaks the interface.** Disable it in Settings → Plugins. If the
  Settings window is affected, quit the app, set `"enabled": false` under
  `plugins.<id>` in `config.json`, and start it again.
- **Reload versus restart.** View → Reload re-runs the preload and renderer
  halves of every plugin but not the main-process backend halves. Use a full
  restart when a backend change is involved.
- **A plugin has no menu submenu.** A plugin only has one when it declares menu
  entries and is enabled. Toggling it in Settings updates the plugin but the
  native menu is rebuilt on the next refresh or restart.

## See also

- [Plugins overview](./index.md) - the complete system reference.
- [Creating a plugin](./creating.md) - write one from scratch.
- [Modifying plugins](./modifying.md) - extend an existing plugin.
- [Themes](../themes/index.md) - the user-installable theme system.
- [Conventions](../conventions.md) - how changes to the app are made.
