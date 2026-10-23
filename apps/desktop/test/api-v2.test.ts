import { describe, expect, it } from "vitest";
import { createV2Routes } from "../src/main/api/v2.ts";
import { runCommand, type WsCommandActions } from "../src/main/api/ws-commands.ts";
import type { Operations } from "../src/main/api/operations.ts";

const recorder = () => {
  const calls: string[] = [];
  const actions: WsCommandActions = {
    next: () => calls.push("next"),
    previous: () => calls.push("previous"),
    play: () => calls.push("play"),
    pause: () => calls.push("pause"),
    setSpeed: (speed) => calls.push(`speed:${speed}`),
    seek: (position) => calls.push(`seek:${position}`),
    setShuffle: (enabled) => calls.push(`shuffle:${enabled}`),
    setRepeat: (mode) => calls.push(`repeat:${mode}`),
    setVolume: (volume) => calls.push(`volume:${volume}`),
    setMute: (muted) => calls.push(`mute:${muted}`),
    rate: (rating) => calls.push(`rate:${rating}`),
  };
  return { calls, actions };
};

const message = (type: string, extra: object = {}) => JSON.stringify({ type, ...extra });

describe("v2 WebSocket commands", () => {
  it("skips forward and back under both spellings", () => {
    for (const [type, expected] of [
      ["NEXT_VIDEO", "next"],
      ["SKIP_VIDEO", "next"],
      ["PREV_VIDEO", "previous"],
      ["PREVIOUS_VIDEO", "previous"],
    ] as const) {
      const { calls, actions } = recorder();
      runCommand(message(type), actions);
      expect(calls).toEqual([expected]);
    }
  });

  it("applies every playback field in order", () => {
    const { calls, actions } = recorder();
    runCommand(
      message("PLAYBACK", { status: "PLAY", speed: 1.5, position: 42, shuffle: true, repeat: "ALL", volume: 60, mute: false }),
      actions,
    );
    expect(calls).toEqual(["play", "speed:1.5", "seek:42", "shuffle:true", "repeat:ALL", "volume:60", "mute:false"]);
  });

  it("ignores values of the wrong type and non-finite numbers", () => {
    const { calls, actions } = recorder();
    runCommand(
      message("PLAYBACK", { status: "STOP", speed: "fast", position: "soon", shuffle: "yes", repeat: "SIDEWAYS", volume: null, mute: 1 }),
      actions,
    );
    runCommand('{"type":"PLAYBACK","speed":1e999,"volume":-1e999,"position":1e999}', actions);
    expect(calls).toEqual([]);
  });

  it("rates and ignores unknown messages", () => {
    for (const status of ["LIKE", "DISLIKE", "INDIFFERENT"]) {
      const { calls, actions } = recorder();
      runCommand(message("RATE", { status }), actions);
      expect(calls).toEqual([`rate:${status}`]);
    }
    const { calls, actions } = recorder();
    runCommand(message("RATE", { status: "LOVE" }), actions);
    runCommand("not json", actions);
    runCommand(Buffer.from("{}"), actions);
    runCommand(null, actions);
    expect(calls).toEqual([]);
  });
});

/** The operations the route table reads; only what the tested routes touch. */
const fakeOperations = () =>
  ({
    playing: () => true,
    playbackSpeed: () => 1.25,
    shuffleState: () => false,
    repeatMode: () => "NONE",
    volume: () => 50,
    muteState: () => false,
    likeState: () => "LIKE",
    patchFeatureFlags: async () => undefined,
    deleteFeatureFlags: async () => undefined,
    featureFlags: async () => [],
    appMeta: async () => ({ name: "pear" }),
    getConfig: () => ({ options: {} }),
  }) as unknown as Operations;

describe("v2 route table", () => {
  it("registers the fork's paths for both methods of each setter", () => {
    const routes = createV2Routes(fakeOperations());
    const keys = new Set(routes.map((route) => `${route.method} ${route.path}`));
    for (const key of [
      "GET /api/v2/video",
      "POST /api/v2/video/next",
      "POST /api/v2/video/prev",
      "POST /api/v2/video/previous",
      "POST /api/v2/video/play",
      "POST /api/v2/video/download",
      "GET /api/v2/video/search",
      "POST /api/v2/video/search",
      "GET /api/v2/browse",
      "POST /api/v2/browse",
      "GET /api/v2/video/lyrics",
      "GET /api/v2/video/lyrics/translations",
      "POST /api/v2/video/lyrics/translations",
      "GET /api/v2/playback",
      "GET /api/v2/playback/speed",
      "POST /api/v2/playback/speed",
      "PATCH /api/v2/playback/speed",
      "GET /api/v2/playback/position",
      "POST /api/v2/playback/position/seek-by",
      "GET /api/v2/playback/shuffle",
      "POST /api/v2/playback/repeat",
      "POST /api/v2/playback/repeat/next",
      "GET /api/v2/volume",
      "PATCH /api/v2/volume",
      "GET /api/v2/volume/mute",
      "POST /api/v2/volume/unmute",
      "POST /api/v2/volume/toggle-mute",
      "GET /api/v2/rating",
      "POST /api/v2/rating",
      "POST /api/v2/rating/like",
      "GET /api/v2/queue",
      "POST /api/v2/queue",
      "PATCH /api/v2/queue/{index}",
      "DELETE /api/v2/queue/{index}",
      "POST /api/v2/queue/index",
      "GET /api/v2/queue/autoplay",
      "DELETE /api/v2/queue",
      "GET /api/v2/pear/config",
      "PATCH /api/v2/pear/settings",
      "GET /api/v2/pear",
      "GET /api/v2/pear/feature-flags",
      "PATCH /api/v2/pear/feature-flags",
      "DELETE /api/v2/pear/feature-flags",
    ]) {
      expect(keys.has(key), key).toBe(true);
    }
  });

  it("answers the cached getters without a page call", async () => {
    const routes = createV2Routes(fakeOperations());
    const route = routes.find((entry) => entry.method === "GET" && entry.path === "/api/v2/playback")!;
    expect(await route.handle({ params: {}, body: {}, query: new URLSearchParams(), remoteAddress: "test" })).toEqual({
      status: 200,
      body: { state: true },
    });
  });
});
