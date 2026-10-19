# Player API

This page is for plugin authors who need YouTube Music's player: current track
data, playback state, seeking, volume, quality, or the audio graph. It covers how
this fork hands you the player object, the types that describe it, the app-level
events layered on top, and the cleanup rules.

## Getting the player object

A renderer plugin receives the player through `onPlayerApiReady`. The lifecycle
around it is described in the [Plugin reference](./index.md); this is the
minimal receiver:

```ts
import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import type { MusicPlayer } from '@/types/music-player';

export default createPlugin({
  name: () => t('plugins.my-plugin.name'),
  config: { enabled: false },
  renderer: {
    api: null as MusicPlayer | null,
    onPlayerApiReady(api) {
      this.api = api;
    },
    stop() {
      this.api = null;
    },
  },
});
```

The call comes from `src/renderer.ts`, in two situations:

- **After boot.** `main()` loads every renderer plugin, then the player is
  located (`initObserver` / `listenForApiLoad`), and `onApiLoaded()` calls
  `onPlayerApiReady(api, context)` for every loaded plugin. A plugin's `start`
  therefore runs before this hook, and the hook is deferred until the page
  actually has a player.
- **After a mid-session enable.** The `plugin:enable` handler starts the plugin
  and then calls `onPlayerApiReady` if the player object already exists.

The `api` argument is `document.querySelector('#movie_player')` typed as
`Element & MusicPlayer`. It is not a wrapper built by this app: it is YouTube
Music's own player proxy, which forwards to the external and trusted/internal
player interfaces. `MusicPlayer` in `src/types/music-player.ts` describes that
surface; the raw methods and their real signatures are covered by the YouTube
Music API reference being added to this docs folder.

Consequences worth designing around:

- The hook only runs when the element exists, so `api` is non-null inside it.
  Your stored field should still be nullable, because `start` runs first and
  `stop` can run without the hook ever having fired.
- The hook can run more than once in a session when a plugin is disabled and
  re-enabled. It is a setup step, not a constructor: remove old listeners before
  adding new ones. `src/plugins/audio-only/index.ts` does exactly that ("The API
  can re-initialize, so drop the old listener instead of stacking").
- The hook is only called for plugins whose `renderer` is an object. A plugin
  written as a single `renderer` function cannot use it.
- Only the page can call it. There is no equivalent in the backend or preload
  context; a main-process plugin works through the renderer over IPC instead, and
  `peard:player-api-loaded` tells it when the player is ready.

Do not query `#movie_player` at module top level. Renderer plugin modules are
part of the injected bundle and can be evaluated before the player page is
ready; `start` and `onPlayerApiReady` are the supported places to touch the DOM.

## The typed surface

`MusicPlayer` mirrors the player proxy but is not equally precise everywhere.
Some methods have exact signatures (`setVolume(volume: number)`,
`seekTo(seconds)`, `addEventListener`); many are declared with generic
`Parameters`/`Return` placeholders because their real signatures live in
minified player code. When a method is loosely typed, cast at the call site or
feature-detect it:

```ts
type PlayerExtras = {
  getPlayerStateObject: () => { isPlaying: boolean; isPaused: boolean };
};

const player = api as MusicPlayer & Partial<PlayerExtras>;
const state = player.getPlayerStateObject?.();
if (state?.isPlaying) {
  // ...
}
```

`getPlayerStateObject` is one of the methods the raw YouTube Music API exposes
but `MusicPlayer` does not model; the YouTube Music API reference being added to
this folder lists the rest.

`getInternalApiInterface` / `getApiInterface` expose the raw trusted and classic
interfaces for anything not modelled on `MusicPlayer`.

The data shapes show up in different places and do not share field naming:

| Accessor | Type | Shape |
| --- | --- | --- |
| `api.getVideoData()` | `VideoDetails` (`src/types/video-details.ts`) | snake_case: `video_id`, `title`, `author`, `list`, `video_quality`, `isLive`, ... |
| `api.getPlayerResponse()` | `GetPlayerResponse` (`src/types/get-player-response.ts`) | full Innertube `/player` response: `videoDetails`, `streamingData`, `playbackTracking`, `captions`, ... |
| `api.getWatchNextResponse()` | `WatchNextResponse` (`src/types/music-player-desktop-internal.ts`) | the `/next` data the app reads; the type currently models `playerOverlays` only |
| `api.addEventListener('videodatachange', ...)` | `VideoDataChangeValue` (`src/types/player-api-events.ts`) | camelCase: `videoId`, `title`, `author`, `playlistId`, `lengthSeconds`, `loading`, ... |

The event payload and `getVideoData()` are not interchangeable: the event uses
`videoId`, the accessor uses `video_id`.

## Reading the current track

Two paths are available, and they answer different questions.

For the track the player is showing right now, use the player:

```ts
onPlayerApiReady(api) {
  const data = api.getVideoData();
  console.log(data.video_id, data.title, data.author);
}
```

`getVideoData()` reflects whatever the player has loaded, so read it from a
`videodatachange` handler rather than assuming a track exists when the hook
fires. `getPlayerResponse()` is the same response the app's song-info pipeline
consumes; it is large and should not be sent across IPC repeatedly.

For the app's processed song info, use the existing pipeline rather than
re-deriving it: `src/providers/song-info-front.ts` caches `getSongInfo()` in the
renderer and main sends the canonical object back as `peard:update-song-info`
(see [Architecture](../architecture.md#player-and-song-info-pipeline)). Anything
that needs artist/title/album/album-art as the rest of the app sees it should
read that, not the raw player response.

## Controlling playback

| Task | Call | Notes |
| --- | --- | --- |
| Play / pause | `playVideo()`, `pauseVideo()` | The type comment warns `playVideo` "does not resume playback; plays from the start"; the app's own `peard:toggle-play` handler still calls it when `getPlayerState() === 2`, so verify behavior if resuming matters to your feature. |
| State | `getPlayerState()` | `1` playing, `2` paused according to the type; `src/plugins/exponential-volume/index.ts` treats `3` as buffering. The raw reference lists the complete enum. |
| Position / duration | `getCurrentTime()`, `getDuration()` | Seconds; position is a float. |
| Seek | `seekTo(seconds)`, `seekBy(deltaSeconds)` | `src/plugins/seek-shortcuts/index.ts` uses `seekBy`; the app's own `peard:seek-to` uses `seekTo`. |
| Volume | `getVolume()`, `setVolume(0..100)`, `mute()`, `unMute()`, `isMuted()` | Volume changes are rejected while buffering; exponential-volume retries on the next state change. |
| Quality | `getAvailableQualityLevels()`, `getPlaybackQuality()`, `setPlaybackQuality()`, `setPlaybackQualityRange()` | `src/plugins/quality-changer/index.tsx` reads the first pair and writes `setPlaybackQualityRange()` then `setPlaybackQuality()`. |
| Fullscreen / inline | `isFullscreen()`, `toggleFullscreen()`, `isInline()`, `setInline()` | The app generally drives fullscreen through the page UI (`src/renderer.ts`), not this API. |

The playback methods are also what the app's own transport controls use:
`peard:play` / `peard:pause` / `peard:toggle-play` call `playVideo` /
`pauseVideo`, and `peard:seek-to` / `peard:seek-by` call `seekTo` / `seekBy`
(`src/renderer.ts`). Volume, shuffle, repeat and fullscreen are driven through
the player bar's DOM instead, so this API is not the only control path in the
app.

## Player events

`MusicPlayer.addEventListener` is typed against `PlayerAPIEvents`
(`src/types/player-api-events.ts`). This fork adds `onVideoProgress` to that
interface and a `PlayerAPIEventArgs` helper in `src/types/music-player.ts`;
upstream code that typed the listener itself may need adjusting.

| Event | Listener arguments | Notes |
| --- | --- | --- |
| `videodatachange` | `(name, data)` | `name` is `'dataloaded'` or `'dataupdated'`; `data` is `VideoDataChangeValue`. |
| `onStateChange` | `(state: number)` | Player state; see `getPlayerState()` above. |
| `onVideoProgress` | `(seconds: number)` | Fires roughly four times a second; throttle anything expensive. |

`videodatachange` is the per-track signal. `dataloaded` fires first and
`dataupdated` follows a moment later, but `dataupdated` is not guaranteed: the
app's song-info listener treats `dataloaded` as the fallback after
`DATAUPDATED_FALLBACK_TIMEOUT_MS` (1500 ms) when `dataupdated` never arrives
(`src/providers/song-info-front.ts`). A plugin that needs the full metadata
should either do the same or read the app's `getSongInfo()`.

Wiring and cleanup follow the same shape everywhere:

```ts
export default createPlugin({
  name: () => t('plugins.my-plugin.name'),
  config: { enabled: false },
  renderer: {
    api: null as MusicPlayer | null,
    progressListener: null as ((seconds: number) => void) | null,
    stateListener: null as (() => void) | null,
    videoDataListener() {
      // runs on dataloaded and, when it arrives, dataupdated
    },
    onPlayerApiReady(api) {
      this.api = api;
      this.progressListener = (seconds) => {
        // sync per-tick UI, e.g. the current lyric line
      };
      this.stateListener = () => {
        // re-read the position after pause or seek
      };
      api.addEventListener('onVideoProgress', this.progressListener);
      api.addEventListener('onStateChange', this.stateListener);
      api.addEventListener('videodatachange', this.videoDataListener);
    },
    stop() {
      if (!this.api) return;
      if (this.progressListener) {
        this.api.removeEventListener('onVideoProgress', this.progressListener);
      }
      if (this.stateListener) {
        this.api.removeEventListener('onStateChange', this.stateListener);
      }
      this.api.removeEventListener('videodatachange', this.videoDataListener);
      this.api = null;
    },
  },
});
```

`removeEventListener` needs the same function reference that was added. Store
arrows on the plugin object (as `synced-lyrics` and `audio-only` do) or use
module-level functions; an inline arrow in `onPlayerApiReady` cannot be removed.

## The main-process signal

When the player is found, the renderer sends one IPC message:

```ts
window.ipcRenderer.send('peard:player-api-loaded');
```

It has no payload and is sent once per renderer boot. Main-process plugins use
it to ask the renderer for the listeners they need, and to re-ask after a
renderer reload (the renderer can reload independently of the main process, so
the request is not a one-time handshake). The API server and Discord plugins are
the reference:

```ts
ctx.ipc.on('peard:player-api-loaded', () => {
  ctx.ipc.send(SONG_INFO_SETUP_CHANNEL, SongInfoEventFlag.TimeChanged);
});
```

`SONG_INFO_SETUP_CHANNEL` and the `SongInfoEventFlag` bitmask are the preferred
way to ask for playback events in bulk. The older per-event
`peard:setup-*-listener` channels have listeners left in `song-info-front.ts` for
compatibility, but nothing in the current tree sends them; do not use them in new
code.

## Window globals available to plugins

The page has no Node or Electron APIs. Preload exposes a small surface; most of
it is typed in `src/reset.d.ts`:

| Global | Use |
| --- | --- |
| `window.mainConfig` | The allowlisted app options and plugin enablement: `get`, `plugins.getPlugins`, `plugins.isEnabled`, `plugins.setOptions` (currently accepted only for `video-toggle`), `getContextMenuHidden`, `getScrobbleOptions`. Keys not on `rendererConfigKeys` in `src/preload.ts` read as `undefined`. |
| `window.ipcRenderer` | The audited IPC surface. `subscribe(channel, listener)` returns an unsubscribe closure and is what `ctx.ipc.on` uses; prefer the context object over calling this directly. |
| `window.electronIs` | The `electron-is` instance, for platform/dev checks. |
| `window.i18n` | `{ t }` bound to the renderer's i18next instance, set up in `src/renderer.ts`. |
| `window.reload` | Reloads the page (sends `peard:reload` to main). |
| `window.peardPerf` | `webFrame.getResourceUsage()`, used by the memory report; exposed in `src/preload.ts`. |

## Caveats

- **This is an internal API.** YouTube Music can change it without notice. The
  stable part is method and event names; signatures and minified internals
  rotate. Feature-detect anything that is not on `MusicPlayer`, and prefer the
  app's providers for song info, audio, and controls over reaching into player
  internals.
- **The player can be absent.** `onPlayerApiReady` may never run (for example a
  window that never loads the player page), so do not dereference a stored `api`
  without a null check.
- **Setup can repeat.** Disabling and re-enabling a plugin runs `stop` and then
  `onPlayerApiReady` again. Idempotent setup, or remove-before-add, keeps
  listeners from stacking.
- **Renderer reloads reset everything in the page.** Renderer plugins are
  recreated and their `onPlayerApiReady` runs again. Main-process plugins keep
  running and must re-arm renderer-side listeners on the next
  `peard:player-api-loaded`.
- **Two events, one name.** `api.addEventListener('videodatachange', ...)` is the
  player event with `(name, data)` arguments; the document's
  `videodatachange` listener instead receives a `detail` object. Handle one of
  them, not both, unless you need the player-specific arguments.
- **Progress is chatty.** `onVideoProgress` fires several times a second. The
  app throttles its own consumer to 250 ms; lyrics-style highlighting can use
  every tick, anything that renders broad UI should not.
- **Do not touch the page DOM at import time.** Module evaluation happens when
  the renderer bundle runs, before the player is guaranteed to exist. Use the
  lifecycle hooks.