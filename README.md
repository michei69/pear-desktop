# Pear Desktop

Pear Desktop is a desktop app for YouTube Music: the site in its own window, with native playback controls, media keys, download support and a set of plugins. This repository is the fork maintained at [michei69/pear-desktop](https://github.com/michei69/pear-desktop); the upstream project is [pear-devs/pear-desktop](https://github.com/pear-devs/pear-desktop).

The fork keeps pear-desktop's application identity, so an existing install keeps its settings, window state and data folder. Report bugs in [this fork's issue tracker](https://github.com/michei69/pear-desktop/issues), not upstream; upstream issues that also affect this fork are welcome here.

## Install

Grab the latest build from the [releases page](https://github.com/michei69/pear-desktop/releases/latest). Beta builds are the rolling prerelease on the same page.

### Linux

Flatpak is the recommended format. AppImage, deb, rpm, snap, tar.gz and freebsd packages are also published. The Flatpak is built against runtime `26.08`.

### macOS

Open the DMG and copy the app to Applications. If macOS says the app is damaged and cannot be opened, remove the quarantine flag:

```sh
/usr/bin/xattr -cr "/Applications/YouTube Music.app"
```

The build is ad-hoc signed, not notarized, because the project has no Apple Developer ID.

### Windows

Run the Web Setup installer. A portable executable is published next to it.

To install on a machine without network access, download the `*.nsis.7z` for your architecture (`x64` or `arm64`) and the matching `*-Setup.exe`, put both in the same directory, and run the installer.

## Features

- YouTube Music in a desktop window, with native media keys, taskbar and tray media controls, MPRIS on Linux, the Touch Bar on macOS, and Discord Rich Presence.
- An in-page settings dialog with search and a standalone settings window (`--settings`) for when the page does not load.
- Folder themes with palettes, presets, live reload and an optional consent-gated script.
- A downloader (yt-dlp or Innertube, with ffmpeg.wasm conversion), synced lyrics with translation, SponsorBlock, an equalizer, a visualizer, crossfade, playback speed and video quality controls, and more.
- Audio-only mode, playback recovery, playlist search, SFW music, search commands, seek shortcuts, a fullscreen auto-hide, a preferred-song option, status-bar lyrics and a skip-AI-slop filter, all as plugins.
- A performance mode that lowers visual cost, an optional in-process GPU, and a memory saver for hidden windows.
- A local HTTP and WebSocket API with v1 and v2 surfaces, an OpenAPI document, Swagger UI, plugin-defined methods and an optional MCP endpoint.
- Shared-link cleaning for the share dialog and **Copy current URL**, Windows System Media Transport Controls, and language sync between the app and YouTube Music.
- Plugins run live: enabling, disabling and most config changes need no restart.
- External-link routing to the browser and a permission-hardened window.

Plugins are compiled into the app. There is no plugin store and no folder for installing third-party plugins; themes are the user-installable extension.

## Plugins

The plugins live in `plugins/`, one workspace package each. The system reference is [docs/plugins/index.md](docs/plugins/index.md); start with [Creating a plugin](docs/plugins/creating.md) to write one, and [Porting from upstream](docs/plugins/porting-from-upstream.md) to bring over a pear-desktop 3.x plugin.

A plugin is one `definePlugin({...})` file with an optional main-process part and page part:

```ts
import { config, definePlugin } from "@pear/sdk";

export default definePlugin({
  id: "my-plugin",
  name: "My plugin",
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

## Themes

Themes are folders under the user data directory's `themes/` folder. Select one in **Options ▸ Theme** or **Settings ▸ Appearance ▸ Theme**. You can import CSS files from the app, edit palettes, and choose presets; a theme script is optional and needs explicit consent.

Read [Writing a theme](docs/themes/authoring.md) for the manifest and folder layout, and [Using themes](docs/themes/using.md) for installation and customisation. Community themes for this app are listed at [michei69/pear-desktop-themes](https://github.com/michei69/pear-desktop-themes).

## Development

Requirements: Node.js 22.12 or newer and pnpm 11.

```sh
git clone https://github.com/michei69/pear-desktop
cd pear-desktop
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` runs electron-vite in development mode.

Useful commands:

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development build and app |
| `pnpm build` | Build `out/` |
| `pnpm start` | Preview the production build |
| `pnpm typecheck` | `tsc` in every workspace package |
| `pnpm lint` | oxlint over `apps`, `packages`, `plugins`, `src` |
| `pnpm format` / `pnpm format:check` | oxfmt over the same tree plus `scripts` |
| `pnpm test` | Vitest in every workspace package with tests |
| `pnpm test:e2e` | Build, then Playwright against the real app |
| `pnpm i18n` | Add missing English keys to `src/i18n/resources/en.json` |
| `pnpm clean` | Remove `out/` and `pack/` |

The docs cover the architecture and conventions: [docs/index.md](docs/index.md), [docs/architecture.md](docs/architecture.md), [docs/conventions.md](docs/conventions.md).

## Build

Packaging uses electron-builder. The scripts write installers into `pack/` and never upload them:

```sh
pnpm dist          # Windows, macOS and Linux targets in one electron-builder pass
pnpm dist:linux    # AppImage, Flatpak, deb, rpm, snap, freebsd, tar.gz
pnpm dist:mac      # dmg, x64
pnpm dist:mac:arm64
pnpm dist:win      # nsis-web and portable
pnpm dist:win:x64
```

The `dist:linux:deb-arm64` and `dist:linux:rpm-arm64` scripts build the architecture-specific Linux packages used for releases. The `beta:linux`, `beta:mac`, `beta:win`, `release:linux`, `release:mac` and `release:win` scripts are the ones CI calls; they add the beta or stable publish channel and still write only to `pack/`.

Beta and release builds are produced by GitHub Actions, not by hand:

- A push to `master` runs `.github/workflows/build.yml`. It stamps `<version>-beta.<run_number>`, builds with `PEAR_CHANNEL=beta`, and publishes the rolling prerelease.
- The manual `Release Pear Desktop` workflow builds the unchanged package version with `PEAR_CHANNEL=stable`, publishes a `v<version>` release, and updates `changelog.md`.

Both workflows use the `beta:*` and `release:*` scripts and install Flatpak runtime and base `26.08` for Linux builds.

## Tests

`pnpm test` runs Vitest for the desktop app, the SDK, the Vite plugin and the plugins that ship tests. `pnpm test:e2e` builds the app and runs Playwright; the e2e suite drives the real site and needs network access. On Linux it opens windows on Xvfb when available; set `PEAR_E2E_SHOW=1` to watch them.

## License

MIT. The fork and upstream copyrights are listed in [license](license).
