import { IDLE, type NowPlaying, type Track } from "@pear/sdk";
import { describe, expect, it } from "vitest";
import { songData } from "../data.ts";

const track: Track = {
  videoId: "abc123",
  title: "Song",
  artist: "Artist",
  album: "Album",
  artworkUrl: "https://example.test/cover.jpg",
  durationSeconds: 200,
  url: "https://music.example.test/watch?v=abc123",
  mediaType: "audio",
};

const state = (patch: Partial<NowPlaying> = {}): NowPlaying => ({
  ...IDLE,
  track,
  status: "playing",
  positionSeconds: 12,
  updatedAt: Date.now(),
  ...patch,
});

describe("Tuna song payload", () => {
  it("keeps reporting playing while the player buffers", () => {
    expect(songData(state({ status: "buffering" }), track, undefined).status).toBe("playing");
  });

  it("reports stopped only for a real pause, idle or the end of the track", () => {
    expect(songData(state({ status: "paused" }), track, undefined).status).toBe("stopped");
    expect(songData(state({ status: "idle" }), track, undefined).status).toBe("stopped");
    expect(songData(state({ status: "ended" }), track, undefined).status).toBe("stopped");
  });

  it("keeps the ad-as-stopped convention", () => {
    expect(songData(state({ ad: true }), track, undefined).status).toBe("stopped");
  });

  it("carries the song info and the track's milliseconds", () => {
    expect(songData(state(), track, { videoId: "abc123", views: 5, tags: ["Tag"] })).toMatchObject({
      album: "Album",
      artists: ["Artist"],
      cover: "https://example.test/cover.jpg",
      duration: 200_000,
      progress: 12_000,
      title: "Song",
      url: track.url,
      tags: ["Tag"],
      alternativeTitle: "",
    });
  });

  it("ignores details belonging to another track", () => {
    expect(songData(state(), track, { videoId: "other", tags: ["Tag"] }).tags).toEqual([]);
  });
});
