// OS media controls. Linux: a full MPRIS player (metadata, artwork, seek,
// volume, shuffle, repeat). Windows and macOS get SMTC / Now Playing from
// Chromium's Media Session integration, which YTM already feeds, so this
// plugin is Linux-only.

import MprisPlayer, { type LoopStatus, type Position } from "@jellybrick/mpris-service";
import { definePlugin, livePosition, type HostContext, type NowPlaying, type RepeatMode, type Track } from "@pear/sdk";
import { debounce, isPlaying, YTM_NAME } from "@pear/sdk/util";
import { openableUrl } from "./open.ts";

/** What only the page knows: YTM's full-screen player and where the queue is at. */
interface PageNav {
  fullscreen: boolean;
  /** Tracks before and after the playing one (autoplay's included). */
  before: number;
  after: number;
}

/** The title and artwork the page can publish before the track's full state. */
interface TrackPreview {
  videoId: string;
  title: string;
  artist: string;
  artworkUrl?: string;
  durationSeconds: number;
}

interface Commands {
  nav(next: PageNav): void;
  preview(track: TrackPreview): void;
}

const secToMicro = (seconds: number) => Math.round(seconds * 1e6);
const microToSec = (micro: number | bigint) => Number(micro) / 1e6;

const LOOP_STATUS: Record<RepeatMode, LoopStatus> = {
  none: MprisPlayer.LOOP_STATUS_NONE,
  all: MprisPlayer.LOOP_STATUS_PLAYLIST,
  one: MprisPlayer.LOOP_STATUS_TRACK,
};
// YTM's repeat button cycles none → all → one.
const REPEAT_CYCLE: readonly RepeatMode[] = ["none", "all", "one"];
/** A position jump bigger than this (beyond normal playback) is a seek. */
const SEEK_THRESHOLD_S = 1.5;
/** The page reports the queue position once YTM's re-rendering settles. */
const NAV_REPORT_DELAY_MS = 200;

type Ctx = HostContext<{}>;

/** Per running host part: applies what the page reports. */
const navReceivers = new WeakMap<object, (nav: PageNav) => void>();
const previewReceivers = new WeakMap<object, (track: TrackPreview) => void>();

export default definePlugin<{}, Commands>({
  id: "media-controls",
  name: "Media controls",
  description: "Control playback from your desktop's media widgets and keys (MPRIS).",
  platforms: ["linux"],
  enabledByDefault: true,
  host: {
    beforeReady(ctx) {
      // Chromium would register a second, less capable MPRIS player.
      ctx.disableFeatures("MediaSessionService");
    },
    start(ctx) {
      let state = ctx.player.state;
      const mpris = createMpris(() => state);
      // The newest track the page has started loading. Its artwork may be the
      // only one known until the full state lands, so keep it until the next
      // track starts; a late update for a previous track must not use it.
      let pending: TrackPreview | undefined;
      // pear-desktop's rules: previous unless at the queue's start; next while
      // tracks follow (autoplay adds them) or the queue repeats.
      let nav: PageNav = { fullscreen: false, before: 0, after: 1 };
      const applyNav = () => {
        const canGoPrevious = nav.before > 0;
        const canGoNext = nav.after > 0 || state.repeat === "all";
        if (mpris.canGoPrevious !== canGoPrevious) mpris.canGoPrevious = canGoPrevious;
        if (mpris.canGoNext !== canGoNext) mpris.canGoNext = canGoNext;
        if (mpris.fullscreen !== nav.fullscreen) mpris.fullscreen = nav.fullscreen;
      };
      navReceivers.set(ctx, (next) => {
        nav = next;
        applyNav();
      });
      previewReceivers.set(ctx, (track) => {
        pending = track;
        // SongInfo waits for artwork decoding; publish the remote URL now so
        // MPRIS clients fetch it in parallel. If this track's full state is
        // already known, keep its album and URL and only fill in the artwork.
        mpris.metadata = state.track?.videoId === track.videoId ? metadata(mpris, state.track, pending) : previewMetadata(mpris, track);
      });
      ctx.onCleanup(() => {
        navReceivers.delete(ctx);
        previewReceivers.delete(ctx);
      });
      applyNav();

      const disposeRequests = handleRequests(ctx, mpris, () => state);

      const apply = (next: NowPlaying, previous: NowPlaying | undefined) => {
        state = next;
        // The page already started another track: this update is the outgoing
        // one, whose metadata (and artwork) must not win over the preview.
        const outgoing = pending !== undefined && next.track?.videoId !== pending.videoId;
        if (!outgoing && (!previous || metadataChanged(previous.track, next.track))) {
          mpris.metadata = metadata(mpris, next.track, pending);
        }
        const status = playbackStatus(next);
        if (mpris.playbackStatus !== status) mpris.playbackStatus = status;
        const volume = next.muted ? 0 : next.volume / 100;
        if (mpris.volume !== volume) mpris.volume = volume;
        if (mpris.loopStatus !== LOOP_STATUS[next.repeat]) mpris.loopStatus = LOOP_STATUS[next.repeat];
        if (mpris.shuffle !== next.shuffle) mpris.shuffle = next.shuffle;
        applyNav();

        // Tell clients about jumps (seeks, track changes) so their progress bars resync.
        if (previous && Math.abs(livePosition(previous, next.updatedAt) - next.positionSeconds) > SEEK_THRESHOLD_S) {
          mpris.seeked(secToMicro(next.positionSeconds));
        }
      };
      apply(state, undefined);
      const stopPlayer = ctx.player.on("change", apply);

      return () => {
        // Stop reacting before the service goes away.
        stopPlayer();
        disposeRequests();
        // mpris-service keeps its bus private and has no close method: drop the
        // connection so a re-registration can own the service name again.
        const internals: { _bus?: { disconnect(): void } } = mpris as unknown as { _bus?: { disconnect(): void } };
        internals._bus?.disconnect();
      };
    },
    commands: {
      nav(next: PageNav) {
        navReceivers.get(this)?.(next);
      },
      preview(track: TrackPreview) {
        previewReceivers.get(this)?.(track);
      },
    },
  },
  page(ctx) {
    let last = "";
    const report = () => {
      const items = ctx.$$("queue.item");
      const index = items.findIndex((item) => item.hasAttribute("selected"));
      const nav: PageNav = {
        fullscreen: !!ctx.$("integrations.fullscreen"),
        before: Math.max(0, index),
        after: index < 0 ? items.length : items.length - index - 1,
      };
      const key = JSON.stringify(nav);
      if (key === last) return;
      last = key;
      void ctx.host.invoke("nav", nav);
    };
    const schedule = debounce(report, NAV_REPORT_DELAY_MS);
    ctx.onCleanup(schedule.cancel);
    ctx.host.handle("fullscreen", (fullscreen) => {
      if (!!ctx.$("integrations.fullscreen") === fullscreen) return;
      if (fullscreen) return ctx.$("integrations.fullscreen_button")?.click();
      // The new player bar's layout has no exit button; Escape (exitFullscreen) is how it leaves.
      const exit = ctx.$("integrations.exit_fullscreen_button");
      if (exit) exit.click();
      else void document.exitFullscreen().catch(() => {});
    });
    ctx.observe("app.layout", { attributes: true, attributeFilter: ["player-fullscreened"] }, () => schedule());
    ctx.observe("queue", { childList: true, subtree: true, attributes: true, attributeFilter: ["selected"] }, () => schedule());
    // Publish the title and artwork as soon as YTM starts loading: MPRIS clients
    // can fetch the artwork in parallel with the page building its full state.
    ctx.player.on("trackLoading", (id) => {
      const details = ctx.player.api?.getPlayerResponse()?.videoDetails;
      if (details?.videoId !== id) return;
      const artworkUrl = largestArtwork(details.thumbnail?.thumbnails ?? []);
      const durationSeconds = Number(details.lengthSeconds);
      const preview: TrackPreview = {
        videoId: id,
        title: details.title,
        artist: details.author,
        durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
        ...(artworkUrl ? { artworkUrl } : {}),
      };
      void ctx.host.invoke("preview", preview).catch((error: unknown) => {
        ctx.log.warn("could not publish the track preview", error);
      });
    });
    ctx.player.on("trackChange", () => schedule());
    report();
  },
});

/** The MPRIS player; its position is read live from `state()`. */
function createMpris(state: () => NowPlaying) {
  class PearMpris extends MprisPlayer {
    override getPosition() {
      return secToMicro(livePosition(state()));
    }
  }
  const mpris = new PearMpris({
    name: "\u0059\u006f\u0075\u0074\u0075\u0062\u0065\u004d\u0075\u0073\u0069\u0063",
    identity: YTM_NAME,
    supportedInterfaces: ["player"],
  });
  mpris.canRaise = true;
  mpris.canQuit = false;
  mpris.desktopEntry = "\u0079\u006f\u0075\u0074\u0075\u0062\u0065\u002d\u006d\u0075\u0073\u0069\u0063";
  mpris.supportedUriSchemes = ["https"];
  mpris.supportedMimeTypes = [];
  mpris.canSeek = true;
  mpris.canSetFullscreen = true;
  return mpris;
}

const trackId = (mpris: MprisPlayer, videoId: string) => mpris.objectPath(`track/${videoId.replace(/[^A-Za-z0-9_]/g, "_")}`);

/** What desktop widgets ask of the player. Returns a disposer for its listeners. */
function handleRequests(ctx: Ctx, mpris: MprisPlayer, state: () => NowPlaying) {
  const control = ctx.player.control;
  mpris.on("play", () => control({ type: "play" }));
  mpris.on("pause", () => control({ type: "pause" }));
  mpris.on("playpause", () => control({ type: "toggle" }));
  mpris.on("stop", () => control({ type: "pause" }));
  mpris.on("next", () => control({ type: "next" }));
  mpris.on("previous", () => control({ type: "previous" }));
  mpris.on("seek", (offset: number) => control({ type: "seekBy", seconds: microToSec(offset) }));
  mpris.on("position", (event: Position) => {
    const { track } = state();
    if (track && event.trackId === trackId(mpris, track.videoId)) {
      control({ type: "seek", seconds: microToSec(event.position) });
    }
  });
  mpris.on("volume", (volume: number) => control({ type: "volume", value: volume * 100 }));
  mpris.on("shuffle", (shuffle: boolean) => {
    if (shuffle !== state().shuffle) control({ type: "shuffle" });
  });
  mpris.on("loopStatus", (status: LoopStatus) => {
    for (let i = 0; i < repeatPresses(state().repeat, status); i++) control({ type: "repeat" });
  });
  mpris.on("raise", () => ctx.focusWindow());
  mpris.on("fullscreen", (fullscreen: boolean) => {
    ctx.request("fullscreen", fullscreen).catch((error: unknown) => ctx.log.warn("could not change full screen", error));
  });
  mpris.on("open", ({ uri }: { uri: string }) => {
    const url = openableUrl(uri);
    if (url) void ctx.window.loadURL(url);
    else ctx.log.warn("not opening a non-YTM link");
  });
  mpris.on("error", (error: Error) => ctx.log.error("MPRIS error", error));

  // `error` stays: a bus error can surface after disconnect, and an unhandled
  // 'error' event would throw.
  const events = [
    "play",
    "pause",
    "playpause",
    "stop",
    "next",
    "previous",
    "seek",
    "position",
    "volume",
    "shuffle",
    "loopStatus",
    "raise",
    "fullscreen",
    "open",
  ] as const;
  return () => {
    for (const event of events) mpris.removeAllListeners(event);
  };
}

/** How many presses of YTM's repeat button get from `current` to `status`. */
function repeatPresses(current: RepeatMode, status: LoopStatus) {
  const target = REPEAT_CYCLE.find((mode) => LOOP_STATUS[mode] === status) ?? "none";
  const steps = REPEAT_CYCLE.indexOf(target) - REPEAT_CYCLE.indexOf(current);
  return (steps + REPEAT_CYCLE.length) % REPEAT_CYCLE.length;
}

function metadataChanged(old: Track | null | undefined, track: Track | null | undefined) {
  return track?.videoId !== old?.videoId || track?.title !== old?.title || track?.artworkUrl !== old?.artworkUrl;
}

/** `mpris:length` for a known length; live streams and unknown durations have none. */
function lengthMetadata(seconds: number) {
  return Number.isFinite(seconds) && seconds > 0 ? { "mpris:length": secToMicro(seconds) } : {};
}

/**
 * The track's metadata, taking the artwork from the page's early preview while
 * the full state has none. A preview for another video is never used: that
 * artwork belongs to a track that is no longer playing.
 */
function metadata(mpris: MprisPlayer, track: Track | null | undefined, preview?: TrackPreview) {
  if (!track) return {};
  const earlyArtwork = preview?.videoId === track.videoId ? preview.artworkUrl : undefined;
  const artworkUrl = track.artworkUrl ?? earlyArtwork;
  return {
    "mpris:trackid": trackId(mpris, track.videoId),
    ...lengthMetadata(track.durationSeconds),
    "xesam:title": track.title,
    "xesam:artist": [track.artist],
    "xesam:url": track.url,
    ...(track.album ? { "xesam:album": track.album } : {}),
    ...(artworkUrl ? { "mpris:artUrl": artworkUrl } : {}),
  };
}

/** What the page knows as soon as a track starts loading, before its artwork decodes. */
function previewMetadata(mpris: MprisPlayer, track: TrackPreview) {
  return {
    "mpris:trackid": trackId(mpris, track.videoId),
    ...lengthMetadata(track.durationSeconds),
    "xesam:title": track.title,
    "xesam:artist": [track.artist],
    ...(track.artworkUrl ? { "mpris:artUrl": track.artworkUrl } : {}),
  };
}

function playbackStatus(state: NowPlaying) {
  if (isPlaying(state)) return MprisPlayer.PLAYBACK_STATUS_PLAYING;
  if (state.track) return MprisPlayer.PLAYBACK_STATUS_PAUSED;
  return MprisPlayer.PLAYBACK_STATUS_STOPPED;
}

/** The highest-resolution thumbnail, as the page's own metadata reader picks it. */
function largestArtwork(thumbnails: readonly { url: string; width: number; height: number }[]) {
  return thumbnails.reduce<(typeof thumbnails)[number] | undefined>(
    (best, thumbnail) => (!best || thumbnail.width * thumbnail.height > best.width * best.height ? thumbnail : best),
    undefined,
  )?.url;
}
