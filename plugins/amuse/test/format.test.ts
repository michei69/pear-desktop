import { IDLE, type NowPlaying } from "@pear/sdk";
import { describe, expect, test } from "vitest";
import { isVideoType, songInfo, toHumanTime, wireMediaType } from "../format.ts";

const playing = (patch: Partial<NowPlaying> = {}): NowPlaying => ({
  ...IDLE,
  track: {
    videoId: "vid",
    title: "Title",
    artist: "Artist",
    durationSeconds: 120,
    url: "https://music.test/watch?v=vid",
    mediaType: "video",
  },
  status: "playing",
  positionSeconds: 30,
  updatedAt: Date.now(),
  ...patch,
});

describe("Amuse query shape", () => {
  test("always has every field, with neutral values for an empty player", () => {
    const info = songInfo(IDLE);
    expect(info.player).toEqual({
      hasSong: false,
      isPaused: true,
      volumePercent: 100,
      seekbarCurrentPosition: 0,
      seekbarCurrentPositionHuman: "0:00",
      statePercent: 0,
      likeStatus: "INDIFFERENT",
      repeatType: "NONE",
      positionUpdatedAt: IDLE.updatedAt,
    });
    expect(info.track).toMatchObject({
      author: "",
      title: "",
      album: "",
      cover: "",
      duration: 0,
      isVideo: false,
      isAdvertisement: false,
      mediaType: "AUDIO",
      playlistId: null,
    });
  });

  test("an empty query keeps the ad flag", () => {
    expect(songInfo({ ...IDLE, ad: true }).track.isAdvertisement).toBe(true);
  });

  test("the raw YTM type wins over the coarse track type", () => {
    const omv = songInfo(playing(), "MUSIC_VIDEO_TYPE_OMV");
    expect(omv.track.mediaType).toBe("ORIGINAL_MUSIC_VIDEO");
    expect(omv.track.isVideo).toBe(false);
    const ugc = songInfo(playing(), "MUSIC_VIDEO_TYPE_UGC");
    expect(ugc.track.mediaType).toBe("USER_GENERATED_CONTENT");
    expect(ugc.track.isVideo).toBe(true);
    expect(songInfo(playing(), "MUSIC_VIDEO_TYPE_PODCAST_EPISODE").track.mediaType).toBe("PODCAST_EPISODE");
  });

  test("falls back to the coarse media type without the raw one", () => {
    expect(wireMediaType("audio", undefined)).toBe("AUDIO");
    expect(wireMediaType("video", undefined)).toBe("VIDEO");
    expect(isVideoType("AUDIO")).toBe(false);
    expect(isVideoType("ORIGINAL_MUSIC_VIDEO")).toBe(false);
    expect(isVideoType("VIDEO")).toBe(true);
  });

  test("position and human time follow the live player state", () => {
    expect(toHumanTime(0)).toBe("0:00");
    expect(toHumanTime(125.9)).toBe("2:05");
    expect(songInfo(playing({ ad: true })).player.isPaused).toBe(true);
  });
});
