import type { YTPlayerApi, YTPlayerAudioTrack } from "@pear/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTrackReapply, MAX_REAPPLY_ATTEMPTS, type TrackReapplyContext } from "../apply.ts";

const track = (id: string) => ({ id }) as YTPlayerAudioTrack;

/** A player whose current track does not follow `setAudioTrack` until `play` says so. */
function fakePlayer(ids: string[], playing: string) {
  const current = { playing };
  const calls: string[] = [];
  const api = {
    getAvailableAudioTracks: () => ids.map(track),
    getAudioTrack: () => track(current.playing),
    setAudioTrack: (next: YTPlayerAudioTrack) => {
      calls.push(next.id ?? "");
    },
  } as unknown as YTPlayerApi;
  return { api, calls, play: (id: string) => (current.playing = id) };
}

function context(api: YTPlayerApi | null, config = { audioTrack: "es", preferOriginal: true }): TrackReapplyContext {
  return {
    config: () => config,
    api: () => api,
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (timer) => clearTimeout(timer),
  };
}

describe("re-apply the preferred audio track", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("caps the retries when the player never switches", () => {
    const player = fakePlayer(["en", "es"], "en");
    const reapply = createTrackReapply(context(player.api));

    for (let attempt = 0; attempt < MAX_REAPPLY_ATTEMPTS + 2; attempt++) reapply.apply();

    expect(player.calls).toHaveLength(MAX_REAPPLY_ATTEMPTS);
    expect(player.calls.every((id) => id === "es")).toBe(true);
  });

  it("gives a new track a fresh retry budget", async () => {
    const player = fakePlayer(["en", "es"], "en");
    const reapply = createTrackReapply(context(player.api));
    for (let attempt = 0; attempt < MAX_REAPPLY_ATTEMPTS + 1; attempt++) reapply.apply();
    expect(player.calls).toHaveLength(MAX_REAPPLY_ATTEMPTS);

    // What the page does on dataloaded or trackChange.
    reapply.reset();
    await vi.advanceTimersByTimeAsync(200);
    expect(player.calls).toHaveLength(MAX_REAPPLY_ATTEMPTS + 1);

    reapply.apply();
    reapply.apply();
    reapply.apply();
    expect(player.calls).toHaveLength(MAX_REAPPLY_ATTEMPTS + 3);
  });

  it("survives later failures after the track converged", () => {
    const player = fakePlayer(["en", "es"], "en");
    const reapply = createTrackReapply(context(player.api));

    reapply.apply();
    expect(player.calls).toHaveLength(1);

    // The player switched: the budget resets, so a later re-emit can retry again.
    player.play("es");
    reapply.apply();
    expect(player.calls).toHaveLength(1);

    player.play("en");
    for (let attempt = 0; attempt < MAX_REAPPLY_ATTEMPTS + 1; attempt++) reapply.apply();
    expect(player.calls).toHaveLength(MAX_REAPPLY_ATTEMPTS + 1);
  });

  it("applies at once with a fresh budget when the setting changes", async () => {
    const player = fakePlayer(["en", "es"], "en");
    const reapply = createTrackReapply(context(player.api));
    for (let attempt = 0; attempt < MAX_REAPPLY_ATTEMPTS + 1; attempt++) reapply.apply();

    reapply.resetNow();
    expect(player.calls).toHaveLength(MAX_REAPPLY_ATTEMPTS + 1);

    // Automatic applies the original track, which already plays: nothing to retry.
    const other = fakePlayer(["en", "es"], "en");
    const automatic = createTrackReapply(context(other.api, { audioTrack: "", preferOriginal: true }));
    automatic.resetNow();
    expect(other.calls).toEqual([]);
  });

  it("leaves a video with a single track alone", () => {
    const player = fakePlayer(["en"], "en");
    const reapply = createTrackReapply(context(player.api, { audioTrack: "en", preferOriginal: false }));

    reapply.apply();

    expect(player.calls).toEqual([]);
  });

  it("stops its pending apply", async () => {
    const player = fakePlayer(["en", "es"], "en");
    const reapply = createTrackReapply(context(player.api));

    reapply.reset();
    reapply.stop();
    await vi.advanceTimersByTimeAsync(1000);

    expect(player.calls).toEqual([]);
  });

  it("does nothing while the player is missing", () => {
    const reapply = createTrackReapply(context(null));
    expect(() => reapply.apply()).not.toThrow();
  });
});
