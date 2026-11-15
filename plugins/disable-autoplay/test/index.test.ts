import type { NowPlaying, PlayerAction, Track } from "@pear/sdk";
import { describe, expect, it } from "vitest";
import plugin from "../index.ts";

type Config = { applyOnce: boolean };

/** The page part as the runner calls it (the plugin's `page` is a plain function). */
const startPage = plugin.page as unknown as (ctx: unknown) => void;

const track = { videoId: "abc" } as Track;

/** A page context with just what this plugin touches: config, player events and control. */
function fakeContext(applyOnce: boolean, loaded: Track | null = null) {
  let config: Config = { applyOnce };
  const listeners = new Map<string, Set<() => void>>();
  const configListeners: ((next: Config) => void)[] = [];
  const player = {
    state: { track: loaded, status: "paused" } as Pick<NowPlaying, "track" | "status">,
    controls: [] as PlayerAction[],
    on(event: string, listener: () => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
      return () => set.delete(listener);
    },
    control(action: PlayerAction) {
      player.controls.push(action);
    },
  };
  const ctx = {
    get config() {
      return config;
    },
    player,
    onConfigChange(listener: (next: Config) => void) {
      configListeners.push(listener);
    },
  };
  return {
    ctx,
    player,
    /** A config change as the runner delivers it. */
    configure(next: Config) {
      config = next;
      for (const listener of configListeners) listener(config);
    },
    emit(event: string) {
      for (const listener of listeners.get(event) ?? []) listener();
    },
    /** How many times the plugin asked the player to pause. */
    pauses: () => player.controls.filter((action) => action.type === "pause").length,
  };
}

describe("disable-autoplay", () => {
  it("with applyOnce pauses only the first track", () => {
    const app = fakeContext(true);
    startPage(app.ctx);

    app.emit("trackLoading");
    app.emit("trackLoading");

    expect(app.pauses()).toBe(1);
  });

  it("without applyOnce pauses every track", () => {
    const app = fakeContext(false);
    startPage(app.ctx);

    app.emit("trackLoading");
    app.emit("trackLoading");

    expect(app.pauses()).toBe(2);
  });

  it("turning applyOnce off re-arms a spent one-shot", () => {
    const app = fakeContext(true);
    startPage(app.ctx);
    app.emit("trackLoading");
    expect(app.pauses()).toBe(1);

    app.configure({ applyOnce: false });
    app.emit("trackLoading");
    app.emit("trackLoading");

    expect(app.pauses()).toBe(3);
  });

  it("pauses a track that loaded before the plugin started", () => {
    const app = fakeContext(true, track);
    startPage(app.ctx);

    // The one-shot applies to the restored track, not to the next one.
    expect(app.pauses()).toBe(1);
    app.emit("trackLoading");
    expect(app.pauses()).toBe(1);
  });

  it("does not spend the one-shot while no track is loaded", () => {
    const app = fakeContext(true);
    startPage(app.ctx);

    expect(app.pauses()).toBe(0);
    app.emit("trackLoading");
    expect(app.pauses()).toBe(1);
  });

  it("stops the first tick of playback after YTM resumes the track", () => {
    const app = fakeContext(true);
    startPage(app.ctx);
    app.emit("trackLoading");
    expect(app.pauses()).toBe(1);

    // While nothing plays, the guard waits.
    app.emit("timeUpdate");
    expect(app.pauses()).toBe(1);

    app.player.state.status = "playing";
    app.emit("timeUpdate");
    expect(app.pauses()).toBe(2);

    // The guard is spent: a later play is the user's own.
    app.emit("timeUpdate");
    expect(app.pauses()).toBe(2);
  });
});
