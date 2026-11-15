import { describe, expect, it } from "vitest";
import {
  collect,
  creditsVideoId,
  playerSetVideoId,
  releasePlaylistId,
  releaseRequestOf,
  studioIdFor,
  studioMetadata,
  swappedQueueRow,
  type QueueItem,
} from "../logic.ts";

const runs = (text: string) => ({ runs: [{ text }] });

/** A release row as the album page serves it: the song is linked through an MPTC credits id. */
const releaseRow = (setId: string, songId: string) => ({
  musicResponsiveListItemRenderer: {
    playlistItemData: { videoId: "video-" + songId, playlistSetVideoId: setId },
    menu: {
      menuRenderer: {
        items: [{ menuNavigationItemRenderer: { navigationEndpoint: { browseEndpoint: { browseId: `MPTC${songId}` } } } }],
      },
    },
  },
});

const queueRow = (videoId: string, videoType = "MUSIC_VIDEO_TYPE_OMV") => ({
  videoId,
  playlistSetVideoId: "000000000000000A",
  title: runs(`${videoId} title`),
  navigationEndpoint: {
    watchEndpoint: { videoId, watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: videoType } } },
  },
});

describe("collect", () => {
  it("finds every value stored at the key, however deeply nested", () => {
    const data = { a: { nested: [{ browseId: "one" }, { deeper: { browseId: "two" } }] } };
    expect(collect<string>(data, "browseId")).toEqual(["one", "two"]);
  });

  it("ignores primitives and missing keys", () => {
    expect(collect(null, "browseId")).toEqual([]);
    expect(collect({ a: 1, b: "two" }, "browseId")).toEqual([]);
  });
});

describe("creditsVideoId", () => {
  it("reads the song behind the MPTC credits browse id", () => {
    expect(creditsVideoId(releaseRow("set", "song-1"))).toBe("song-1");
  });

  it("returns nothing for a row without credits", () => {
    expect(creditsVideoId({ playlistItemData: { playlistSetVideoId: "set" } })).toBeUndefined();
  });
});

describe("releasePlaylistId", () => {
  it("accepts only album-release playlist ids", () => {
    expect(releasePlaylistId("OLAK5uy_album")).toBe("OLAK5uy_album");
    expect(releasePlaylistId("RDAMPLmix")).toBeNull();
    expect(releasePlaylistId(undefined)).toBeNull();
  });
});

describe("playerSetVideoId", () => {
  const params = (setId: string) => encodeURIComponent(btoa("\xf0\x05\x01" + setId));

  it("reads the set id out of the opaque params blob", () => {
    expect(playerSetVideoId(params("000000000000000A"))).toBe("000000000000000A");
  });

  it("treats params it cannot decode as no set id", () => {
    expect(playerSetVideoId("not base64")).toBeNull();
    expect(playerSetVideoId(params(""))).toBeNull();
    expect(playerSetVideoId(42)).toBeNull();
  });
});

describe("releaseRequestOf", () => {
  const params = encodeURIComponent(btoa("\xf0\x05\x01" + "000000000000000A"));

  it("matches a player request that belongs to a release row", () => {
    expect(releaseRequestOf({ playlistId: "OLAK5uy_album", params })).toEqual({
      playlistId: "OLAK5uy_album",
      setId: "000000000000000A",
    });
  });

  it("leaves mixes and stand-alone videos alone", () => {
    expect(releaseRequestOf({ playlistId: "RDAMPLmix", params })).toBeNull();
    expect(releaseRequestOf({ playlistId: "OLAK5uy_album" })).toBeNull();
  });
});

describe("studioIdFor", () => {
  const studios = new Map([["set-1", "song-1"]]);

  it("maps a release row to its song", () => {
    expect(studioIdFor(studios, "set-1", "video-1")).toBe("song-1");
  });

  it("does nothing when the row already is the song or is unknown", () => {
    expect(studioIdFor(studios, "set-1", "song-1")).toBeNull();
    expect(studioIdFor(studios, "set-2", "video-2")).toBeNull();
  });
});

describe("swappedQueueRow", () => {
  it("rewrites the video id and type everywhere in the row", () => {
    const swapped = swappedQueueRow(queueRow("video-1") as QueueItem, "song-1");
    expect(JSON.stringify(swapped)).not.toContain("video-1");
    expect(JSON.stringify(swapped)).not.toContain("MUSIC_VIDEO_TYPE_OMV");
    expect(JSON.stringify(swapped)).toContain("song-1");
    expect(JSON.stringify(swapped)).toContain("MUSIC_VIDEO_TYPE_ATV");
  });

  it("leaves a row without an id untouched", () => {
    const row = { title: runs("no id") } as QueueItem;
    expect(swappedQueueRow(row, "song-1")).toEqual(row);
  });
});

describe("studioMetadata", () => {
  it("takes the song row's display fields", () => {
    const studio: QueueItem = {
      videoId: "song-1",
      title: runs("Song"),
      longBylineText: runs("Artist"),
      shortBylineText: runs("Artist"),
      lengthText: runs("3:00"),
      thumbnail: { thumbnails: [{ url: "song.jpg" }] },
    };
    expect(studioMetadata(studio)).toEqual({
      title: runs("Song"),
      longBylineText: runs("Artist"),
      shortBylineText: runs("Artist"),
      lengthText: runs("3:00"),
      thumbnail: { thumbnails: [{ url: "song.jpg" }] },
    });
  });

  it("leaves out the fields the song row does not have", () => {
    expect(studioMetadata({ videoId: "song-1" })).toEqual({});
  });
});
