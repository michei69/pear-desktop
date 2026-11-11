import { IDLE, type NowPlaying, type Track } from "@pear/sdk";
import { describe, expect, it } from "vitest";
import { type Play, ScrobbleTracker, type ScrobbleMemory, scrobbleThreshold } from "../tracker.ts";

const track = (videoId: string, durationSeconds: number): Track => ({
  videoId,
  title: `Song ${videoId}`,
  artist: "Artist",
  durationSeconds,
  url: `https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/watch?v=${videoId}`,
  mediaType: "audio",
});

function setup(memory?: ScrobbleMemory) {
  const nowPlaying: Play[] = [];
  const scrobbles: Play[] = [];
  const tracker = new ScrobbleTracker({ nowPlaying: (p) => nowPlaying.push(p), scrobble: (p) => scrobbles.push(p) }, memory);
  let now = 1_000_000;
  let state: NowPlaying = { ...IDLE };
  const set = (patch: Partial<NowPlaying>) => {
    state = { ...state, ...patch, updatedAt: now };
    tracker.update(state, now);
  };
  /** Advances time, sending position updates every second like the page does. */
  const advance = (seconds: number) => {
    for (let i = 0; i < seconds; i++) {
      now += 1000;
      const playing = state.status === "playing" && !state.ad;
      set(playing ? { positionSeconds: state.positionSeconds + 1 } : {});
    }
  };
  return { tracker, nowPlaying, scrobbles, set, advance, now: () => now };
}

describe("scrobbleThreshold", () => {
  it("is half the duration (rounded up), capped at 4 minutes, as pear-desktop", () => {
    expect(scrobbleThreshold(200)).toBe(100);
    expect(scrobbleThreshold(201)).toBe(101);
    expect(scrobbleThreshold(600)).toBe(240);
  });
  it("applies to short tracks too", () => {
    expect(scrobbleThreshold(30)).toBe(15);
    expect(scrobbleThreshold(12)).toBe(6);
  });
  it("never scrobbles when the duration is unknown", () => {
    expect(scrobbleThreshold(0)).toBeNull();
  });
});

describe("ScrobbleTracker", () => {
  it("sends now playing on start and scrobbles at half the duration", () => {
    const t = setup();
    t.set({ track: track("a", 200), status: "playing", positionSeconds: 0 });
    expect(t.nowPlaying).toHaveLength(1);
    const startedAt = t.now();
    t.advance(99);
    expect(t.scrobbles).toHaveLength(0);
    t.advance(1);
    expect(t.scrobbles).toEqual([{ track: track("a", 200), startedAt }]);
    t.advance(100);
    expect(t.scrobbles).toHaveLength(1);
  });

  it("scrobbles after 4 minutes for long tracks", () => {
    const t = setup();
    t.set({ track: track("long", 3600), status: "playing" });
    t.advance(239);
    expect(t.scrobbles).toHaveLength(0);
    t.advance(1);
    expect(t.scrobbles).toHaveLength(1);
  });

  it("does not count paused time, and re-sends now playing on resume", () => {
    const t = setup();
    t.set({ track: track("a", 200), status: "playing" });
    t.advance(60);
    t.set({ status: "paused" });
    t.advance(300);
    expect(t.scrobbles).toHaveLength(0);
    expect(t.tracker.position(t.now())).toBe(60);
    t.set({ status: "playing" });
    expect(t.nowPlaying).toHaveLength(2);
    t.advance(40);
    expect(t.scrobbles).toHaveLength(1);
  });

  it("does not count ads", () => {
    const t = setup();
    t.set({ track: track("a", 200), status: "playing", ad: true });
    t.advance(120);
    expect(t.nowPlaying).toHaveLength(0);
    expect(t.scrobbles).toHaveLength(0);
    t.set({ ad: false });
    expect(t.nowPlaying).toHaveLength(1);
    t.advance(100);
    expect(t.scrobbles).toHaveLength(1);
  });

  it("goes by the position: seeking past the threshold counts", () => {
    const t = setup();
    t.set({ track: track("a", 200), status: "playing" });
    t.advance(10);
    t.set({ positionSeconds: 150 });
    expect(t.scrobbles).toHaveLength(1);
  });

  it("scrobbles short tracks too, at half their length", () => {
    const t = setup();
    t.set({ track: track("jingle", 25), status: "playing" });
    t.advance(12);
    expect(t.scrobbles).toHaveLength(0);
    t.advance(1);
    expect(t.nowPlaying).toHaveLength(1);
    expect(t.scrobbles).toHaveLength(1);
  });

  it("never scrobbles a track of unknown length", () => {
    const t = setup();
    t.set({ track: track("live", 0), status: "playing" });
    t.advance(600);
    expect(t.nowPlaying).toHaveLength(1);
    expect(t.scrobbles).toHaveLength(0);
    expect(t.tracker.timeUntilScrobble(t.now())).toBeNull();
  });

  it("starts over when the track changes, without carrying listening time", () => {
    const t = setup();
    t.set({ track: track("a", 200), status: "playing" });
    t.advance(90);
    t.set({ track: track("b", 200), positionSeconds: 0 });
    expect(t.nowPlaying.map((p) => p.track.videoId)).toEqual(["a", "b"]);
    t.advance(20);
    expect(t.scrobbles).toHaveLength(0);
    t.advance(80);
    expect(t.scrobbles.map((p) => p.track.videoId)).toEqual(["b"]);
  });

  it("counts a replay of the same track (repeat one) as a new play", () => {
    const t = setup();
    t.set({ track: track("a", 200), status: "playing" });
    t.advance(198);
    expect(t.scrobbles).toHaveLength(1);
    t.set({ positionSeconds: 0 });
    t.advance(100);
    expect(t.scrobbles).toHaveLength(2);
    expect(t.nowPlaying).toHaveLength(2);
  });

  it("counts playing again after the end as a new play", () => {
    const t = setup();
    t.set({ track: track("a", 200), status: "playing" });
    t.advance(120);
    t.set({ status: "ended" });
    t.set({ status: "playing", positionSeconds: 0 });
    t.advance(100);
    expect(t.scrobbles).toHaveLength(2);
  });

  it("reports the time left until the threshold for timers", () => {
    const t = setup();
    t.set({ track: track("a", 200), status: "playing" });
    t.advance(30);
    expect(t.tracker.timeUntilScrobble(t.now())).toBe(70_000);
    expect(t.tracker.timeUntilScrobble(t.now() + 5_000)).toBe(65_000);
    t.set({ status: "paused" });
    expect(t.tracker.timeUntilScrobble(t.now())).toBeNull();
  });

  it("does not resubmit a play that went out before the plugin was restarted", () => {
    const memory: ScrobbleMemory = { videoId: undefined };
    const first = setup(memory);
    first.set({ track: track("a", 4), status: "playing" });
    first.set({ positionSeconds: 2 });
    expect(first.scrobbles).toHaveLength(1);
    expect(memory.videoId).toBe("a");

    // The host part was rebuilt while the same play kept going, already past half its length.
    const second = setup(memory);
    second.set({ track: track("a", 4), status: "playing", positionSeconds: 3 });
    expect(second.scrobbles).toHaveLength(0);

    // A different track is a new play and still scrobbles.
    second.set({ track: track("b", 4), positionSeconds: 2 });
    expect(second.scrobbles.map((play) => play.track.videoId)).toEqual(["b"]);
  });

  it("releases the submitted memory for another track, so coming back can scrobble", () => {
    const memory: ScrobbleMemory = { videoId: undefined };
    const t = setup(memory);
    t.set({ track: track("a", 4), status: "playing" });
    t.set({ positionSeconds: 2 });
    expect(t.scrobbles).toHaveLength(1);

    t.set({ track: track("b", 4), positionSeconds: 0 });
    t.set({ track: track("a", 4), positionSeconds: 2.5 });
    expect(t.scrobbles.map((play) => play.track.videoId)).toEqual(["a", "a"]);
  });

  it("keeps the submitted memory when a restarted tracker first sees the idle mirror", () => {
    const memory: ScrobbleMemory = { videoId: "a" };
    const tracker = setup(memory);
    tracker.set({ track: null, status: "idle" });
    tracker.set({ track: track("a", 4), status: "playing", positionSeconds: 3 });
    expect(tracker.scrobbles).toHaveLength(0);
  });

  it("counts the track as a new play after the player went idle", () => {
    const memory: ScrobbleMemory = { videoId: undefined };
    const t = setup(memory);
    t.set({ track: track("a", 4), status: "playing" });
    t.set({ positionSeconds: 2 });
    expect(t.scrobbles).toHaveLength(1);

    t.set({ track: null, status: "idle" });
    t.set({ track: track("a", 4), status: "playing", positionSeconds: 2.5 });
    expect(t.scrobbles).toHaveLength(2);
  });

  it("forgets the play when the player goes idle", () => {
    const t = setup();
    t.set({ track: track("a", 200), status: "playing" });
    t.advance(50);
    t.set({ track: null, status: "idle" });
    expect(t.tracker.position(t.now())).toBe(0);
    expect(t.tracker.timeUntilScrobble(t.now())).toBeNull();
  });
});
