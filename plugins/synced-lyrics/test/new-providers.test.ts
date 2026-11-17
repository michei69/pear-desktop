import { beforeEach, describe, expect, test } from "vitest";
import { betterlyrics, parseTtmlResponse } from "../providers/betterlyrics.ts";
import { cleanLrc, cleanTitle, durationDiff, kugou, parseCandidates } from "../providers/kugou.ts";
import {
  cleanArtist,
  normalizeElrc,
  paxsenix,
  parseAppleSearch,
  parseLyricsPayload,
  resetPaxsenixToken,
  scoreHits,
  searchTerms,
} from "../providers/paxsenix.ts";
import { removeNoobSyncCredit } from "../providers/simpmusic.ts";
import type { SearchQuery } from "../types.ts";

const query: SearchQuery = {
  videoId: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up (Official Video)",
  artist: "Rick Astley",
  durationSeconds: 213,
  inexact: true,
};

function mockFetch(routes: [RegExp, unknown][]) {
  const calls: string[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) return new Response("not found", { status: 404 });
    const body = route[1];
    const answer = typeof body === "function" ? (body as () => unknown)() : body;
    if (answer instanceof Response) return answer;
    return new Response(typeof answer === "string" ? answer : JSON.stringify(answer));
  };
  return Object.assign(fetch, { calls });
}

const TTML = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml"><body><div>
  <p begin="00:00:01.000" end="00:00:03.000"><span begin="00:00:01.000" end="00:00:02.000">Never</span> <span begin="00:00:02.000" end="00:00:03.000">gonna</span></p>
  <p begin="00:00:03.000" end="00:00:05.000">give you up</p>
</div></body></tt>`;

describe("KuGou", () => {
  test("cleans titles and credits, and accepts seconds or milliseconds", () => {
    expect(cleanTitle("Song (Official Video)")).toBe("Song");
    expect(cleanLrc("[00:01.00]作词: Someone\n[00:02.00]hello\nmetadata").trim()).toBe("[00:02.00]hello");
    expect(durationDiff(213000, 213)).toBe(0);
    expect(durationDiff(220, 213)).toBe(7);
  });

  test("parses only candidates with an id and access key", () => {
    expect(parseCandidates({ candidates: [{ id: 1, accesskey: "k", duration: 213000 }, { id: 2, duration: 1 }, null] })).toEqual([
      { id: 1, accesskey: "k", duration: 213000 },
    ]);
  });

  test("picks the closest-duration candidate and decodes its base64 LRC", async () => {
    const lrc = Buffer.from("[00:01.00]hello\n[00:02.00]world").toString("base64");
    const fetch = mockFetch([
      [
        /lyrics\.kugou\.com\/search/,
        {
          candidates: [
            { id: 1, accesskey: "far", duration: 400 },
            { id: 2, accesskey: "near", duration: 213000 },
          ],
        },
      ],
      [/lyrics\.kugou\.com\/download/, { content: lrc }],
    ]);
    const result = await kugou(query, fetch);
    expect(result?.lines?.map((line) => line.text)).toEqual(["hello", "world"]);
    expect(fetch.calls.some((call) => call.includes("accesskey=near"))).toBe(true);
  });
});

describe("BetterLyrics", () => {
  test("reads the ttml field and turns it into timed lines", async () => {
    expect(parseTtmlResponse({ ttml: TTML })).toBe(TTML);
    const fetch = mockFetch([[/lyrics-api\.boidu\.dev\/getLyrics/, { ttml: TTML }]]);
    const result = await betterlyrics(query, fetch);
    expect(result?.lines?.map((line) => line.text)).toEqual(["Never gonna", "give you up"]);
    expect(result?.lines?.[0]?.words).toHaveLength(2);
  });

  test("retries without the album when the first lookup is empty", async () => {
    const fetch = mockFetch([[/lyrics-api\.boidu\.dev\/getLyrics/, { ttml: "" }]]);
    expect(await betterlyrics({ ...query, album: "Album" }, fetch)).toBeNull();
    expect(fetch.calls.some((call) => call.includes("al=Album"))).toBe(true);
    expect(fetch.calls.some((call) => !call.includes("al="))).toBe(true);
  });
});

describe("Paxsenix", () => {
  beforeEach(resetPaxsenixToken);

  test("builds search terms and cleans collaborating artists", () => {
    expect(searchTerms(query)).toEqual(["Never Gonna Give You Up Rick Astley", "Never Gonna Give You Up"]);
    expect(cleanArtist("Rick Astley feat. Someone")).toBe("Rick Astley");
  });

  test("reads Apple's resource map", () => {
    const parsed = parseAppleSearch({
      results: { songs: { data: [{ id: "1" }] } },
      resources: { songs: { "1": { attributes: { name: "Song", artistName: "Artist", durationInMillis: 213000 } } } },
    });
    expect(parsed).toEqual([{ id: "1", trackName: "Song", artistName: "Artist", durationMs: 213000 }]);
  });

  test("scores a matching track above an unrelated one", () => {
    const hits = [
      { id: "1", trackName: "Never Gonna Give You Up", artistName: "Rick Astley", durationMs: 213000 },
      { id: "2", trackName: "Paradise", artistName: "Uriah Heep", durationMs: 300000 },
    ];
    const scored = scoreHits(hits, query);
    expect(scored[0]?.hit.id).toBe("1");
    expect(scored.some((entry) => entry.hit.id === "2")).toBe(false);
  });

  test("converts packed enhanced-LRC word markers", () => {
    const lrc = normalizeElrc("[00:01.00](v1):<hello:1.00:1.20> <world:1.20:1.50>");
    expect(lrc).toBe("[00:01.00]<00:01.00>hello <00:01.20>world");
  });

  test("falls back from TTML to plain lyrics in a payload", () => {
    const result = parseLyricsPayload(JSON.stringify({ type: "None", plain: "one\ntwo" }), "Song", "Artist");
    expect(result?.plain).toBe("one\ntwo");
    expect(result?.artists).toEqual(["Artist"]);
  });

  test("scrapes a token, searches Apple and fetches the matched lyrics", async () => {
    const fetch = mockFetch([
      [/beta\.music\.apple\.com$/, '<script src="/assets/index~abc.js"></script>'],
      [/index~abc\.js/, "const t = 'eyJhbGciOi.signature.part';"],
      [
        /amp-api\.music\.apple\.com/,
        {
          results: { songs: { data: [{ id: "42" }] } },
          resources: {
            songs: { "42": { attributes: { name: "Never Gonna Give You Up", artistName: "Rick Astley", durationInMillis: 213000 } } },
          },
        },
      ],
      [/lyrics\.paxsenix\.org/, JSON.stringify({ plain: "one\ntwo" })],
    ]);
    const result = await paxsenix(query, fetch);
    expect(result?.plain).toBe("one\ntwo");
    expect(fetch.calls.some((call) => call.includes("amp-api.music.apple.com"))).toBe(true);
    expect(fetch.calls.some((call) => call.includes("id=42"))).toBe(true);
  });
});

describe("SimpMusic credit", () => {
  test("drops the Noob.exe credit line but keeps timed lyrics", () => {
    const lyrics = "[00:01.00]hello\n[00:02.00]Synced by Noob.exe\n[00:03.00]world";
    expect(removeNoobSyncCredit(lyrics)).toBe("[00:01.00]hello\n[00:03.00]world");
  });
});
