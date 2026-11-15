import { describe, expect, it } from "vitest";
import { applyFilters, DEFAULT_FILTERS, scrobbleNames } from "../filters.ts";

const options = { alternativeTitles: true, alternativeArtist: true, customRegexFilters: DEFAULT_FILTERS };

describe("scrobbleNames", () => {
  it("prefers the alternative title and the first tag when enabled", () => {
    expect(scrobbleNames({ title: "Title", artist: "Artist", alternativeTitle: "Original", tags: ["Canonical"] }, options)).toEqual({
      scrobbleTitle: "Original",
      scrobbleArtist: "Canonical",
    });
  });

  it("keeps the track's names when those options are off", () => {
    expect(
      scrobbleNames(
        { title: "Title", artist: "Artist", alternativeTitle: "Original", tags: ["Canonical"] },
        { ...options, alternativeTitles: false, alternativeArtist: false },
      ),
    ).toEqual({ scrobbleTitle: "Title", scrobbleArtist: "Artist" });
  });

  it("applies the default filters to both names, as a scrobble does", () => {
    expect(scrobbleNames({ title: "Song (Official Video)", artist: "Artist (feat. Guest)" }, options)).toEqual({
      scrobbleTitle: "Song",
      scrobbleArtist: "Artist",
    });
  });

  it("applies the user's filters too, and skips one that does not compile", () => {
    expect(scrobbleNames({ title: "Song [x]", artist: "Artist" }, { ...options, customRegexFilters: ["\\[x\\]", "("] })).toEqual({
      scrobbleTitle: "Song",
      scrobbleArtist: "Artist",
    });
    expect(applyFilters("Keep", "Keep", ["("])).toEqual({ scrobbleTitle: "Keep", scrobbleArtist: "Keep" });
  });
});
