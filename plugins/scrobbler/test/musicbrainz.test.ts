import { describe, expect, it } from "vitest";
import { fetchMusicBrainzCorrection } from "../musicbrainz.ts";
import type { Fetch } from "../services.ts";

function fakeFetch(reply: unknown) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(JSON.stringify(reply), { status: 200 });
  };
  return { fetch, calls };
}

describe("fetchMusicBrainzCorrection", () => {
  it("identifies the app with its version and the contact email, as MusicBrainz asks", async () => {
    const { fetch, calls } = fakeFetch({
      recordings: [{ id: "1", title: "Corrected Title", score: 100, "artist-credit": [{ name: "Corrected Artist" }] }],
    });
    const correction = await fetchMusicBrainzCorrection("Unversioned Request", "Artist", "me@example.com", "4.0.0", fetch);
    expect(correction).toEqual({ title: "Corrected Title", artist: "Corrected Artist" });
    expect(calls[0]!.headers["User-Agent"]).toBe("pear-desktop/4.0.0 ( me@example.com )");
    expect(calls[0]!.headers.From).toBe("me@example.com");
  });
});
