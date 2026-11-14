import { describe, expect, test } from "vitest";
import { buildSearchQuery } from "../types.ts";

const base = { videoId: "abc", title: "Song", artist: "Artist", durationSeconds: 200, inexact: false };

describe("buildSearchQuery", () => {
  test("the track's own metadata", () => {
    expect(buildSearchQuery({ ...base, album: "Album", custom: null })).toStrictEqual({
      videoId: "abc",
      title: "Song",
      artist: "Artist",
      album: "Album",
      durationSeconds: 200,
      inexact: false,
    });
  });

  test("a custom search replaces the title and artist", () => {
    expect(buildSearchQuery({ ...base, custom: { query: "Other", artist: "Someone" }, details: null })).toStrictEqual({
      videoId: "abc",
      title: "Other",
      artist: "Someone",
      durationSeconds: 200,
      inexact: false,
      alternativeTitle: "Other",
    });
  });

  test("song details add the original title and the tags when they differ", () => {
    expect(buildSearchQuery({ ...base, custom: null, details: { alternativeTitle: "Son", tags: ["Tag"] } })).toMatchObject({
      alternativeTitle: "Son",
      tags: ["Tag"],
    });
    expect(buildSearchQuery({ ...base, custom: null, details: { alternativeTitle: "Song", tags: [] } })).not.toHaveProperty(
      "alternativeTitle",
    );
    expect(buildSearchQuery({ ...base, custom: { query: "Other" }, details: { tags: ["Tag"] } })).toMatchObject({ tags: ["Tag"] });
  });
});
