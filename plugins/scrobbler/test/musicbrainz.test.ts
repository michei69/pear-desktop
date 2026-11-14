import { describe, expect, it } from "vitest";
import { fetchMusicBrainzCorrection } from "../musicbrainz.ts";
import { fakeFetch } from "./fake-fetch.ts";

describe("fetchMusicBrainzCorrection", () => {
  it("identifies the app with its version and the contact email, as MusicBrainz asks", async () => {
    const { fetch, calls } = fakeFetch({
      recordings: [{ id: "1", title: "Corrected Title", score: 100, "artist-credit": [{ name: "Corrected Artist" }] }],
    });
    const correction = await fetchMusicBrainzCorrection("Unversioned Request", "Artist", "me@example.com", "4.0.0", fetch);
    expect(correction).toEqual({ title: "Corrected Title", artist: "Corrected Artist" });
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe("pear-desktop/4.0.0 ( me@example.com )");
    expect(headers.From).toBe("me@example.com");
  });
});
