import { IDLE, type NowPlaying, type Track } from "@pear/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../src/main/config.ts";
import { createOperations, type OperationEnvironment } from "../src/main/api/operations.ts";
import { PlayerState } from "../src/main/api/player-state.ts";
import type { PluginHost } from "../src/main/plugins.ts";

// `appMeta` imports Electron; the tested operations never call it.
vi.mock("electron", () => ({ app: { getVersion: () => "0.0.0", getAppPath: () => "/app" } }));

const track: Track = {
  videoId: "v1",
  title: "Song",
  artist: "Artist",
  durationSeconds: 200,
  url: "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=v1",
  mediaType: "audio",
};
const playing: NowPlaying = { ...IDLE, track, status: "playing" };

/** The operations with a fake page, plugins and settings; only what the tested calls touch. */
function fixture(overrides: Partial<OperationEnvironment> = {}, core: { siteFlags?: string[]; performanceFlags?: boolean } = {}) {
  const emitted: { name: string; payload: unknown }[] = [];
  const playerState = new PlayerState(() => playing);
  playerState.update(playing, playing);
  const page = vi.fn(async () => undefined) as unknown as OperationEnvironment["page"];
  const env: OperationEnvironment = {
    state: () => playing,
    details: () => undefined,
    control: () => undefined,
    page,
    playerState,
    plugins: { callRpc: async () => ({ ok: true, value: {} }) } as unknown as PluginHost,
    settings: {
      plugin: () => ({ enabled: true }),
      core: (section: string) =>
        section === "site"
          ? { siteFlags: core.siteFlags ?? [] }
          : section === "performance"
            ? { flags: core.performanceFlags === true }
            : {},
      setCore: () => undefined,
    } as unknown as Settings,
    emit: (name, payload) => emitted.push({ name, payload }),
    applyConfig: async () => undefined,
    ...overrides,
  };
  return { operations: createOperations(env), emitted, playerState, page };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("translations", () => {
  it("names the song a translation belongs to, even without one in the request", async () => {
    const callRpc = vi.fn(async () => ({ ok: true as const, value: { language: "en", lines: [{ text: "hi" }] } }));
    const { operations, emitted } = fixture({ plugins: { callRpc } as unknown as PluginHost });
    expect(await operations.translateLyrics("en")).toMatchObject({ ok: true });
    expect(emitted).toEqual([{ name: "translation", payload: { language: "en", videoId: "v1", lines: [{ text: "hi" }] } }]);
    expect(callRpc).toHaveBeenCalled();
  });

  it("keeps the id the request asked about", async () => {
    const { operations, emitted } = fixture();
    await operations.translateLyrics("en", "v2");
    expect(emitted[0]?.payload).toMatchObject({ videoId: "v2" });
  });

  it("gives a provider the long budget, and reports a timeout as a bad gateway", async () => {
    vi.useFakeTimers();
    const { operations } = fixture({ plugins: { callRpc: () => new Promise(() => undefined) } as unknown as PluginHost });
    const answer = operations.translateLyrics("en");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await answer).toEqual({ ok: false, status: 502, error: "synced-lyrics: translateLyrics did not answer in time" });
  });
});

describe("playback speed", () => {
  it("answers from the cache instead of waiting for the page", async () => {
    const { operations, playerState } = fixture({ page: (() => new Promise(() => undefined)) as OperationEnvironment["page"] });
    playerState.setSpeed(1.25);
    expect(await operations.playbackSpeed()).toBe(1.25);
  });

  it("caches what the API sets", async () => {
    const { operations } = fixture();
    operations.setPlaybackSpeed(1.5);
    expect(await operations.playbackSpeed()).toBe(1.5);
  });
});

describe("video", () => {
  it("reports the scrobbler's resolved names for the song", async () => {
    const callRpc = vi.fn(async () => ({ ok: true as const, value: { scrobbleTitle: "Song (Filtered)", scrobbleArtist: "Artist" } }));
    const { operations } = fixture({ plugins: { callRpc } as unknown as PluginHost });
    const result = await operations.video();
    expect(result).toMatchObject({ ok: true, value: { scrobbleTitle: "Song (Filtered)", scrobbleArtist: "Artist" } });
    expect(callRpc).toHaveBeenCalledWith("scrobbler", "names", { title: "Song", artist: "Artist" });
  });

  it("answers with the track's own names when the scrobbler is off", async () => {
    const callRpc = async () => ({ ok: false as const, status: 503, error: 'plugin "scrobbler" is disabled' });
    const { operations } = fixture({ plugins: { callRpc } as unknown as PluginHost });
    expect(await operations.video()).toMatchObject({ ok: true, value: { scrobbleTitle: "Song", scrobbleArtist: "Artist" } });
  });
});

describe("lyrics", () => {
  it("asks for the video the request names, not only the playing one", async () => {
    const callRpc = vi.fn(async () => ({ ok: true as const, value: { videoId: "other", activeProvider: null, providers: [] } }));
    const { operations } = fixture({ plugins: { callRpc } as unknown as PluginHost });
    expect(await operations.lyrics("other")).toMatchObject({ ok: true });
    expect(callRpc).toHaveBeenCalledWith("synced-lyrics", "lyrics", { videoId: "other" });
  });

  it("asks for the current track when no video is named", async () => {
    const callRpc = vi.fn(async () => ({ ok: true as const, value: { videoId: "v1", activeProvider: null, providers: [] } }));
    const { operations } = fixture({ plugins: { callRpc } as unknown as PluginHost });
    await operations.lyrics();
    expect(callRpc).toHaveBeenCalledWith("synced-lyrics", "lyrics", {});
  });
});

describe("feature flags", () => {
  it("reports the performance switch's flags as set by the app, not as overrides", async () => {
    const flags = await fixture({}, { siteFlags: ["web_animated_actions=true"], performanceFlags: true }).operations.featureFlags();
    // The user's own override is marked as theirs and keeps its value…
    expect(flags.find((flag) => flag.name === "web_animated_actions")).toEqual({
      name: "web_animated_actions",
      value: true,
      overridden: true,
    });
    // …while the flags the performance switch sets are listed, unmarked.
    expect(flags.find((flag) => flag.name === "web_watch_cinematics_disabled_by_default")).toEqual({
      name: "web_watch_cinematics_disabled_by_default",
      value: true,
      overridden: false,
    });
  });

  it("lists only the saved overrides when the performance switch is off", async () => {
    const flags = await fixture({}, { siteFlags: ["music_web_optimize_queue_rendering=false"] }).operations.featureFlags();
    expect(flags).toEqual([{ name: "music_web_optimize_queue_rendering", value: false, overridden: true }]);
  });

  it("lets the page's live value win over the applied one", async () => {
    const page = (async () => ({ web_animated_actions: true })) as unknown as OperationEnvironment["page"];
    const flags = await fixture({ page }, { performanceFlags: true }).operations.featureFlags();
    expect(flags.find((flag) => flag.name === "web_animated_actions")).toEqual({
      name: "web_animated_actions",
      value: true,
      overridden: false,
    });
  });

  it("puts the page's own value back only for a saved override", async () => {
    const page = vi.fn(async () => undefined);
    const { operations } = fixture({ page: page as unknown as OperationEnvironment["page"] }, { siteFlags: ["saved_flag=1"] });

    await operations.deleteFeatureFlags(["saved_flag", "web_watch_cinematics_disabled_by_default"]);
    expect(page.mock.calls).toEqual([["flags:remove", "saved_flag"]]);
  });
});

describe("page timeouts", () => {
  it("gives search and browse the v1 controller's 30 s while other reads keep the default", async () => {
    const calls: unknown[][] = [];
    const page = (async (...args: unknown[]) => {
      calls.push(args);
      return undefined;
    }) as unknown as OperationEnvironment["page"];
    const { operations } = fixture({ page });
    await operations.search({ query: "x" });
    await operations.browse({ browseId: "MPREb1" });
    await operations.queue(false);
    expect(calls).toEqual([
      ["search:parsed", { query: "x", params: undefined, continuation: undefined, raw: false }, { timeout: 30_000 }],
      ["browse", { browseId: "MPREb1", continuation: undefined, raw: false }, { timeout: 30_000 }],
      ["queue:parsed", { raw: false }, undefined],
    ]);
  });
});
