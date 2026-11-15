import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import plugin from "../index.ts";
import type { Submission } from "../segments.ts";

/** The parts of the page context the plugin uses, with the player's media faked. */
class FakeVideo extends EventTarget {
  seeking = false;
  currentTime = 0;
}

class FakeApi {
  time = 0;
  duration = 200;
  videoId = "initialvid0";
  getCurrentTime() {
    return this.time;
  }
  getDuration() {
    return this.duration;
  }
  getVideoData() {
    return { video_id: this.videoId };
  }
}

const submission = (start: number, end: number, videoDuration = 200): Submission => ({
  segment: [start, end],
  category: "sponsor",
  actionType: "skip",
  videoDuration,
});

interface StartOptions {
  /** Segments by video id; the track loaded at start is "initialvid0". */
  segments?: Record<string, Submission[]>;
  time?: number;
}

function harness({ segments = { initialvid0: [submission(10, 20)] }, time = 0 }: StartOptions = {}) {
  const api = new FakeApi();
  api.time = time;
  const video = new FakeVideo();
  video.currentTime = time;
  const controls: { type: string; seconds?: number }[] = [];
  const playerListeners = new Map<string, (value: unknown) => void>();
  const state = { ad: false };
  const cleanups: (() => void)[] = [];

  const ctx = {
    config: {
      apiURL: "https://sponsor.example",
      showSegmentsOnProgressBar: false,
      music_offtopic: true,
      sponsor: true,
      selfpromo: true,
      interaction: true,
      intro: true,
      outro: true,
      preview: false,
      filler: false,
    },
    player: {
      get state() {
        return state;
      },
      ready: async () => api,
      videoReady: async () => video,
      on(event: string, listener: (value: unknown) => void) {
        playerListeners.set(event, listener);
        return () => {};
      },
      control(action: { type: string; seconds?: number }) {
        controls.push(action);
        if (action.type !== "seek" || action.seconds === undefined) return;
        // What YTM does: move the media, then report the seek as done.
        video.seeking = true;
        api.time = action.seconds;
        video.currentTime = action.seconds;
        video.seeking = false;
        video.dispatchEvent(new Event("seeked"));
      },
    },
    host: {
      invoke: vi.fn(async (_command: string, videoId: string) => segments[videoId] ?? []),
    },
    listen(target: EventTarget, type: string, listener: EventListener) {
      target.addEventListener(type, listener);
    },
    onConfigChange: vi.fn(),
    onCleanup(fn: () => void) {
      cleanups.push(fn);
    },
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    t: (_key: string, fallback?: string) => fallback ?? _key,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };

  const page = plugin.page as unknown as (ctx: unknown) => Promise<() => void>;
  const started = page(ctx);

  /** Flushes the segment fetch and its first skip. */
  const settle = async () => {
    await started;
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  return {
    api,
    video,
    controls,
    settle,
    /** A timeupdate at the media's current position. */
    tick(at = api.time) {
      api.time = at;
      video.currentTime = at;
      video.dispatchEvent(new Event("timeupdate"));
    },
    /** A completed seek, as the media reports it. */
    seekTo(at: number) {
      api.time = at;
      video.currentTime = at;
      video.seeking = false;
      video.dispatchEvent(new Event("seeked"));
    },
    loadTrack(videoId: string, at = 0) {
      api.videoId = videoId;
      api.time = at;
      video.currentTime = at;
      playerListeners.get("trackLoading")?.(videoId);
    },
    setAd(ad: boolean) {
      state.ad = ad;
    },
  };
}

beforeEach(() => {
  // renderMarkers/resetSegments query the page; nothing is drawn in these tests.
  vi.stubGlobal("document", { querySelector: () => null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sponsorblock's skip loop", () => {
  test("skips the segment the playhead is inside and then leaves it alone", async () => {
    const app = harness({ time: 12 });
    await app.settle();

    expect(app.controls).toEqual([{ type: "seek", seconds: 20 }]);
    // Our own seek's `seeked` is not a user seek: a later short landing still skips.
    app.tick(19);
    expect(app.controls).toHaveLength(2);
    app.controls.length = 0;
    app.tick(20);
    expect(app.controls).toEqual([]);
  });

  test("lets a deliberate seek inside a segment play until it ends", async () => {
    const app = harness({ time: 0, segments: { initialvid0: [submission(10, 20), submission(30, 40)] } });
    await app.settle();
    expect(app.controls).toEqual([]);

    // The user seeks into the first segment: no skip, however many ticks follow.
    app.seekTo(15);
    app.tick(15);
    app.tick(18);
    expect(app.controls).toEqual([]);

    // Playing out of it re-enables skipping for the next segment.
    app.tick(21);
    expect(app.controls).toEqual([]);
    app.tick(31);
    expect(app.controls).toEqual([{ type: "seek", seconds: 40 }]);
  });

  test("ignores a position reported while a seek is in flight", async () => {
    const app = harness({ time: 0, segments: { initialvid0: [submission(10, 20)] } });
    await app.settle();

    // The media says it is still seeking; the position is not playback yet.
    app.api.time = 15;
    app.video.currentTime = 15;
    app.video.seeking = true;
    app.tick(15);
    expect(app.controls).toEqual([]);

    // Completed as the user's seek: playback inside the segment is left alone.
    app.video.seeking = false;
    app.seekTo(15);
    app.tick(16);
    expect(app.controls).toEqual([]);
  });

  test("forgets the suppression when the track changes", async () => {
    const app = harness({
      time: 0,
      segments: { initialvid0: [submission(10, 20)], nextvideo01: [submission(0, 10)] },
    });
    await app.settle();
    app.seekTo(15);
    app.tick(16);
    expect(app.controls).toEqual([]);

    app.loadTrack("nextvideo01", 5);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(app.controls).toEqual([{ type: "seek", seconds: 10 }]);
  });

  test("never skips during an ad", async () => {
    const app = harness({ time: 12 });
    app.setAd(true);
    await app.settle();
    expect(app.controls).toEqual([]);
    app.setAd(false);
    app.tick(12);
    expect(app.controls).toEqual([{ type: "seek", seconds: 20 }]);
  });
});
