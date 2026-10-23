# Player API

The player is YTM's own `#movie_player` element, wrapped by `packages/page/src/player.ts`. Plugins see it through `ctx.player` on both sides: a page facade that owns the real player, and a host mirror for main-process integrations. The types are in `packages/sdk/src/player.ts`.

## NowPlaying

Every player event and `ctx.player.state` use the same shape:

| Field | Type | Meaning |
| --- | --- | --- |
| `track` | `Track \| null` | The current track, with `videoId`, `title`, `artist`, `album?`, `artworkUrl?`, `durationSeconds`, `url`, `playlistId?` and `mediaType`. |
| `status` | `"idle" \| "playing" \| "paused" \| "buffering" \| "ended"` | Playback state. |
| `positionSeconds` | `number` | Position at `updatedAt`. Use `livePosition(state)` for the current position. |
| `volume` | `number` | 0 to 100. |
| `muted` | `boolean` | Mute state. |
| `repeat` | `"none" \| "all" \| "one"` | Repeat mode. |
| `shuffle` | `boolean` | Shuffle state. |
| `like` | `"like" \| "dislike" \| "none"` | Current rating. |
| `ad` | `boolean` | An ad is playing. Position and status still describe the track. |
| `updatedAt` | `number` | `Date.now()` of the last update. |

`livePosition(state)` returns the stored position while paused, buffering, ended or during an ad, and extrapolates from `updatedAt` while playing, clamped to the track duration. The API server and host integrations use it.

## Page player

| Member | Purpose |
| --- | --- |
| `player.state` | The current `NowPlaying`. |
| `player.ready()` | Resolves with YTM's player API once it exists. |
| `player.api` | The player API, or `null` before then. |
| `player.videoReady()` | Resolves with YTM's `<video>`; YTM adds it a little after the player object. |
| `player.video()` | The `<video>`, or `null`. |
| `player.on(event, listener)` | Subscribes; returns an unsubscribe. Removed automatically when the plugin stops. |
| `player.control(action)` | Runs a `PlayerAction`. |

Events:

| Event | Listener arguments | Notes |
| --- | --- | --- |
| `trackLoading` | `videoId` | As soon as YTM starts loading a track, before its metadata is complete. |
| `trackChange` | `Track` | Once the track metadata is ready. |
| `statusChange` | `PlaybackStatus` | Play, pause, buffer, end. |
| `timeUpdate` | `seconds` | Once per second of track playback; never during ads. |
| `adChange` | `boolean` | Ad started or ended. |
| `volumeChange` | `volume, muted` | Volume or mute changed. |
| `change` | `NowPlaying` | Any state change. |

Position updates are published to the host at most once per second; using the page events directly is not throttled beyond YTM's own `timeupdate` rate.

## Player actions

```ts
ctx.player.control({ type: "next" });
ctx.player.control({ type: "seek", seconds: 42 });
ctx.player.control({ type: "volume", value: 65 });
```

| Action | Fields |
| --- | --- |
| `play`, `pause`, `toggle` | none |
| `next`, `previous` | none |
| `seek` | `seconds` |
| `seekBy` | `seconds`, negative to go back |
| `volume` | `value`, 0 to 100 |
| `mute` | `muted?`; omitted toggles |
| `like`, `dislike`, `shuffle`, `repeat` | none |

The page implementation prefers clicking the player bar's own controls or moving its own sliders, so YTM applies the action exactly as it does for a user. It falls back to the player API methods when a control is not rendered, for example in the new player-bar layout.

## Host player

| Member | Purpose |
| --- | --- |
| `player.state` | The mirror of the page's last published state. |
| `player.on("change", listener)` | `(state, previous)`. |
| `player.on("trackChange", listener)` | `(track, state)`; also fires when the same video's title changes. |
| `player.control(action)` | Sends the action to the page. |
| `player.details(options?)` | Extra metadata of the current track, or `null`. |

The mirror starts at `IDLE` until a page runtime publishes its first state. `control()` sends a `player-control` event to the page; it does nothing while no YTM window is up.

`details()` asks the page for `SongDetails`:

| Field | Meaning |
| --- | --- |
| `videoId` | Which track the details describe. |
| `views?`, `uploadDate?` | From YTM's player response. |
| `alternativeTitle?` | A localized or romanized title YTM offers for some tracks. |
| `tags` | YTM's tags; the first is usually the canonical artist. |
| `artistUrl?` | Channel URL. |
| `musicVideoType?` | YTM's raw type, finer than `Track.mediaType`. |

The request is answered by the page runtime's own handler with a 5 second default timeout, shorter than a plugin's own 10 second page request. A missing page yields `null` rather than an error, so integrations degrade gracefully.

## YTM's player API

`ctx.player.ready()` resolves with the subset of `#movie_player` typed in `YTPlayerApi`:

- Playback: `playVideo`, `pauseVideo`, `nextVideo`, `previousVideo`, `seekTo(seconds, allowSeekAhead?)`.
- Position and duration: `getCurrentTime`, `getDuration`.
- Volume: `getVolume`, `setVolume`, `isMuted`, `mute`, `unMute`.
- State and rate: `getPlayerState`, `getPlaybackRate`, `setPlaybackRate`, `getAvailablePlaybackRates`.
- Quality: `getPlaybackQuality`, `getAvailableQualityLevels`, `setPlaybackQualityRange(min, max?)`.
- Data: `getVideoData()`, `getPlayerResponse()`. `getVideoData()` is synchronous and cheap; the response is the raw player response with `videoDetails`, `microformat` and `captions`.
- Events: `addEventListener`, `removeEventListener`. Prefer `ctx.player.on`; raw listeners are not removed when the plugin stops unless registered with `ctx.listen(api, type, listener)`.

The API object is an `HTMLElement` that YTM upgrades after creating it; the facade polls until the methods exist. Do not cache `ctx.player.api` across a plugin restart: a page reload creates a new object.

## Queue helpers

`packages/sdk/src/queue.ts` reads YTM's queue element and its private Redux-shaped store, so plugins that skip, filter or inspect queue entries share one implementation:

```ts
import { queueItems, queueSelectedIndex, queueRenderer, queueDispatch } from "@pear/sdk";

const items = queueItems();
const index = queueSelectedIndex(items);
const current = queueRenderer(items[index]);
queueDispatch({ type: "REMOVE_ITEM", payload: index });
```

| Helper | Returns |
| --- | --- |
| `playerQueue()` | The queue element (`selectors.queue`), or `null` when YTM has not rendered one. |
| `queueStore()` | The element's `queue` object with `getItems()` and the nested store. |
| `queueItems()` | `QueueItem[]`; empty when there is no queue. |
| `queueRenderer(item)` | The `playlistPanelVideoRenderer` inside an item, unwrapping the wrapper renderer. |
| `queueSelectedIndex(items)` | Index of the selected item, `-1` when none is selected. |
| `queueDispatch(action)` | Dispatches a queue action; a no-op without a queue. |

`QueueItem` keeps YTM's raw fields; `queueRenderer(item)?.videoId`, `.title`, `.thumbnail`, `.lengthText` and `.shortBylineText` are the stable ones used by the app. Do not assume the queue store exists: check for `null` and handle an empty list.

The page-side API server handlers use these helpers for queue reads, inserts, moves, removals, clearing and play-at-index. The v2 API additionally maps raw renderers into a stable queue shape in `packages/page/src/queue.ts`, and parses search and browse responses in `packages/page/src/search.ts` and `packages/page/src/browse.ts`. A plugin that needs the same behavior should call its own page code, or use the API server's routes when a page request is acceptable.

## Audio graph

`ctx.audio()` returns the shared `AudioGraph`:

```ts
const graph = await ctx.audio();
const filter = graph.context.createBiquadFilter();
filter.type = "lowshelf";
filter.frequency.value = 200;
const remove = graph.insert(filter);
const analyser = graph.context.createAnalyser();
const untap = graph.tap(analyser);
```

| Member | Purpose |
| --- | --- |
| `context`, `source`, `video` | The one `AudioContext`, its source node and the `<video>`. |
| `insert(input, output?, order?)` | Adds a processing stage between the source and the destination. Lower `order` runs earlier. Returns an unsubscribe. |
| `tap(node)` | Connects the final output to an analyser or recorder as well. Returns an unsubscribe. |

Stages and taps are removed when the plugin stops. Never create a second `MediaElementAudioSourceNode` for the same `<video>`, and never call `video.play()` from an audio plugin to compensate; use `ctx.player.control`.

## Player bar layouts

YTM gives some users a new player bar. `packages/sdk/src/selectors.ts` maps each `player_bar.*` name to both layouts, using `:is(...)` where both exist. A plugin that uses selector names works on both; one that writes YTM's class names works on one. The site setting `site.playerBar` (`Site's choice`, `Classic`, `New`) lets you test both.
