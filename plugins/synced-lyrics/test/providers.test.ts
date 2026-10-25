import { beforeEach, describe, expect, test } from "vitest";
import { artistSimilarity, jaroWinkler, titleSimilarity } from "../match.ts";
import { extractLyrics } from "../providers/genius.ts";
import { SearchCache } from "../providers/index.ts";
import { lrclib } from "../providers/lrclib.ts";
import { megalobiz, pickSheet, sheetToResult } from "../providers/megalobiz.ts";
import {
  buildQuery,
  netease,
  parseSearchResponse,
  pickOriginalTitle,
  resetNeteaseSession,
  scoreCandidate,
  splitTitle,
} from "../providers/netease.ts";
import { isUsableToken, musixmatch, parseMacro, resetMusixmatchToken } from "../providers/musixmatch.ts";
import { ytmusic } from "../providers/ytmusic.ts";
import type { SearchQuery } from "../types.ts";
// Recorded from the real APIs (October 2026), lyrics cut to a few lines.
import megalobizLrc from "./fixtures/megalobiz-lrc.json" with { type: "json" };
import megalobizSearch from "./fixtures/megalobiz-search.json" with { type: "json" };
import musixmatchDecoy from "./fixtures/musixmatch-macro-decoy.json" with { type: "json" };
import musixmatchToken from "./fixtures/musixmatch-token-anonymous.json" with { type: "json" };
// The mobile app's token.get answer; its token is replaced by a placeholder.
import musixmatchMobileToken from "./fixtures/musixmatch-token-mobile.json" with { type: "json" };

const query: SearchQuery = {
  videoId: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up",
  artist: "Rick Astley",
  durationSeconds: 213,
  inexact: true,
};

function mockFetch(routes: [RegExp, unknown][]) {
  const calls: string[] = [];
  const inits: RequestInit[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    inits.push(init ?? {});
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) return new Response("not found", { status: 404 });
    const body = route[1];
    const answer = typeof body === "function" ? (body as () => unknown)() : body;
    return new Response(typeof answer === "string" ? answer : JSON.stringify(answer));
  };
  return Object.assign(fetch, { calls, inits });
}

const entry = (overrides: object) => ({
  id: 1,
  trackName: "Never Gonna Give You Up",
  artistName: "Rick Astley",
  duration: 213,
  instrumental: false,
  plainLyrics: "plain",
  syncedLyrics: null,
  ...overrides,
});

describe("original-language title and tags, as pear-desktop", () => {
  test("LRCLIB searches the original title and accepts an artist named by a tag", async () => {
    const japanese = {
      ...query,
      title: "Pretender",
      artist: "Higedan",
      alternativeTitle: "プリテンダー",
      tags: ["Official髭男dism"],
      durationSeconds: 326,
    };
    const fetch = mockFetch([
      [
        /q=%E3%83%97/,
        [entry({ trackName: "プリテンダー", artistName: "Official髭男dism", duration: 326, syncedLyrics: "[00:01.00]hello" })],
      ],
      [/search/, []],
    ]);
    const result = await lrclib(japanese, fetch);
    expect(result?.lines?.map((line) => line.text)).toContain("hello");
    expect(fetch.calls.some((call) => call.includes("q=%E3%83%97"))).toBe(true);
    // Without the tag, the artist doesn't match.
    expect(await lrclib({ ...japanese, tags: [] }, fetch)).toBeNull();
  });
});

describe("match", () => {
  test("jaro-winkler", () => {
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 3);
    expect(jaroWinkler("", "a")).toBe(0);
  });
  test("titles ignore bracketed extras", () => {
    expect(titleSimilarity("Never Gonna Give You Up (Official Video)", "Never Gonna Give You Up")).toBe(1);
    expect(titleSimilarity("Paradise", "Never Gonna Give You Up")).toBeLessThan(0.7);
  });
  test("artists compare across collaborators", () => {
    expect(artistSimilarity("Rick Astley, Rick Astley", "Rick Astley")).toBe(1);
    expect(artistSimilarity("Daft Punk & Pharrell Williams", "Pharrell Williams")).toBe(1);
    expect(artistSimilarity("Drake", "Uriah Heep")).toBeLessThan(0.7);
  });
});

describe("lrclib", () => {
  test("prefers synced lyrics with the closest duration by the right artist", async () => {
    const fetch = mockFetch([
      [
        /lrclib\.net\/api\/search/,
        [
          entry({ id: 1, artistName: "Some Cover Band", syncedLyrics: "[00:01.00]wrong artist" }),
          entry({ id: 2, duration: 260, syncedLyrics: "[00:01.00]wrong length" }),
          entry({ id: 3, duration: 212 }),
          entry({ id: 4, duration: 214, syncedLyrics: "[00:19.32]We're no strangers to love\n[00:23.21]You know the rules" }),
        ],
      ],
    ]);
    const result = await lrclib(query, fetch);
    expect(result?.lines?.map((l) => l.text)).toEqual(["", "We're no strangers to love", "You know the rules"]);
    expect(result?.plain).toBe("plain");
    expect(fetch.calls[0]).toContain("track_name=Never+Gonna+Give+You+Up");
  });

  test("returns null for instrumentals and when nothing matches", async () => {
    expect(await lrclib(query, mockFetch([[/search/, [entry({ instrumental: true })]]]))).toBeNull();
    expect(await lrclib(query, mockFetch([[/search/, []]]))).toBeNull();
  });

  test("uses word timing from the lyricsfile", async () => {
    const lyricsfile =
      "lines:\n- text: Never gonna\n  start_ms: 1000\n  end_ms: 2000\n  words:\n  - text: Never\n    start_ms: 1000\n  - text: gonna\n    start_ms: 1500\n";
    const result = await lrclib(
      query,
      mockFetch([[/search/, [entry({ hasWordSync: true, lyricsfile, syncedLyrics: "[00:01.00]Never gonna" })]]]),
    );
    expect(result?.lines?.[1]?.words?.map((w) => [w.text, w.startMs, w.endMs])).toEqual([
      ["Never ", 1000, 1500],
      ["gonna", 1500, 2000],
    ]);
  });

  test("propagates HTTP errors", async () => {
    await expect(lrclib(query, async () => new Response("", { status: 500 }))).rejects.toThrow(/500/);
  });
});

describe("ytmusic", () => {
  const next = {
    contents: {
      tabs: [
        {
          tabRenderer: {
            endpoint: {
              browseEndpoint: {
                browseId: "MPLYt_test",
                browseEndpointContextSupportedConfigs: {
                  browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_TRACK_LYRICS" },
                },
              },
            },
          },
        },
      ],
    },
  };
  const timed = (lines: object[]) => ({
    contents: {
      elementRenderer: {
        newElement: { type: { componentType: { model: { timedLyricsModel: { lyricsData: { timedLyricsData: lines } } } } } },
      },
    },
  });

  test("reads timed lyrics", async () => {
    const result = await ytmusic(
      query,
      mockFetch([
        [/\/next/, next],
        [
          /\/browse/,
          timed([
            { lyricLine: "One", cueRange: { startTimeMilliseconds: "1000", endTimeMilliseconds: "2000" } },
            { lyricLine: "♪", cueRange: { startTimeMilliseconds: "2000", endTimeMilliseconds: "4000" } },
          ]),
        ],
      ]),
    );
    expect(result?.lines?.map((l) => [l.startMs, l.endMs, l.text])).toEqual([
      [0, 1000, ""],
      [1000, 2000, "One"],
      [2000, 4000, ""],
    ]);
  });

  test("falls back to plain lines without cue ranges", async () => {
    const result = await ytmusic(
      query,
      mockFetch([
        [/\/next/, next],
        [/\/browse/, timed([{ lyricLine: "One" }, { lyricLine: "Two" }])],
      ]),
    );
    expect(result).toMatchObject({ plain: "One\nTwo" });
    expect(result?.lines).toBeUndefined();
  });

  test("returns null without a lyrics tab", async () => {
    expect(await ytmusic(query, mockFetch([[/\/next/, { contents: {} }]]))).toBeNull();
  });
});

describe("genius", () => {
  test("extracts lyrics from the preloaded state", () => {
    const page = `<script>window.__PRELOADED_STATE__ = JSON.parse('{\\"body\\":{\\"html\\":\\"<p>[Chorus]<br>\\\\nNever &amp; ever<\\\\/p>\\",\\"children\\":[]}}');</script>`;
    expect(extractLyrics(page)).toBe("[Chorus]\nNever & ever");
  });
});

describe("SearchCache", () => {
  test("reuses results and forgets failures", async () => {
    const cache = new SearchCache();
    let runs = 0;
    const ok = () => (runs++, Promise.resolve({ title: "t", artists: [], plain: "x" }));
    await cache.get("LRCLib", query, ok);
    await cache.get("LRCLib", query, ok);
    expect(runs).toBe(1);

    const failing = () => (runs++, Promise.reject(new Error("offline")));
    await expect(cache.get("LyricsGenius", query, failing)).rejects.toThrow();
    await expect(cache.get("LyricsGenius", query, failing)).rejects.toThrow();
    expect(runs).toBe(3);
  });
});

const yellow: SearchQuery = { videoId: "yKNxeF4KMsY", title: "Yellow", artist: "Coldplay", durationSeconds: 269, inexact: false };

describe("megalobiz", () => {
  test("picks the sheet closest in duration and reads its lines", async () => {
    const fetch = mockFetch([
      [/\/v1\/search\?/, megalobizSearch],
      [/\/v1\/lrc\/8510$/, megalobizLrc],
    ]);
    const result = await megalobiz(yellow, fetch);
    expect(fetch.calls[0]).toContain("title=Yellow&artist=Coldplay&duration=269");
    expect(result).toMatchObject({ title: "Yellow", artists: ["Coldplay"], url: "https://megalobiz.com/lrc/8510/yellow" });
    expect(result?.lines?.slice(0, 3).map((l) => [l.startMs, l.endMs, l.text])).toEqual([
      [0, 33240, ""],
      [33240, 36010, "Look at the stars"],
      [36010, 41500, "Look how they shine for you"],
    ]);
  });

  test("rejects sheets of other songs or lengths", () => {
    const [sheet] = megalobizSearch.results;
    expect(pickSheet([{ ...sheet!, artist: "Some Cover Band" }], yellow)).toBeUndefined();
    expect(pickSheet([{ ...sheet!, duration: 300 }], yellow)).toBeUndefined();
    expect(pickSheet([{ ...sheet!, title: "Paradise" }], yellow)).toBeUndefined();
    expect(pickSheet(megalobizSearch.results, { ...yellow, durationSeconds: 271 })?.id).toBe(72486);
  });

  test("falls back to the LRC text", () => {
    const { lines: _, ...lrcOnly } = megalobizLrc;
    expect(sheetToResult(lrcOnly)?.lines?.[1]).toMatchObject({ startMs: 33240, text: "Look at the stars" });
    expect(sheetToResult({ ...lrcOnly, lrc: "[ar:Coldplay]" })).toBeNull();
  });

  test("returns null when nothing matches", async () => {
    expect(await megalobiz(yellow, mockFetch([[/search/, { count: 0, results: [] }]]))).toBeNull();
  });
});

describe("musixmatch", () => {
  const options = { tokenMode: "auto" as const, userToken: "", t: (_key: string, english = "") => english };
  const tokenCalls = (fetch: ReturnType<typeof mockFetch>) => fetch.calls.filter((call) => call.includes("token.get"));
  const macroCalls = (fetch: ReturnType<typeof mockFetch>) => fetch.calls.filter((call) => call.includes("macro.subtitles.get"));

  beforeEach(resetMusixmatchToken);

  // The decoy answer, with the track, lyrics and LRC of Yellow instead.
  const yellowAnswer = () => {
    const answer = structuredClone(musixmatchDecoy) as Record<string, any>;
    const calls = answer.message.body.macro_calls;
    Object.assign(calls["matcher.track.get"].message.body.track, { track_name: "Yellow", artist_name: "Coldplay" });
    calls["track.lyrics.get"].message.body.lyrics.lyrics_body =
      "Look at the stars\nLook how they shine\n\n******* This Lyrics is NOT for Commercial use *******\n(1409623456789)";
    calls["track.subtitles.get"].message.body.subtitle_list[0].subtitle.subtitle_body =
      "[00:33.24] Look at the stars\n[00:36.01] Look how they shine";
    return answer;
  };
  const rejected = { message: { header: { status_code: 401, hint: "captcha" }, body: "" } };
  const tokenAnswer = (token: string) => ({ message: { header: { status_code: 200 }, body: { user_token: token } } });

  test("auto: fetches the mobile app's token, ignores the user token and reuses it", async () => {
    const fetch = mockFetch([
      [/token\.get/, musixmatchMobileToken],
      [/macro\.subtitles\.get/, yellowAnswer()],
    ]);
    const result = await musixmatch(yellow, fetch, { ...options, userToken: "2501abc" });

    expect(result).toMatchObject({ title: "Yellow", artists: ["Coldplay"], plain: "Look at the stars\nLook how they shine" });
    expect(result?.lines?.map((l) => l.text)).toEqual(["", "Look at the stars", "Look how they shine"]);
    expect(tokenCalls(fetch)).toHaveLength(1);
    expect(fetch.calls[0]).toContain("https://apic-appmobile.musixmatch.com/ws/1.1/token.get?app_id=mac-ios-v2.0");
    // The mobile app's headers, as pear-desktop sent them.
    expect(fetch.inits[0]?.headers).toMatchObject({
      "x-mxm-app-version": "10.1.1",
      "X-User-Agent": expect.stringContaining("Musixmatch/"),
    });
    expect(fetch.calls[1]).toContain("usertoken=" + musixmatchMobileToken.message.body.user_token);
    expect(fetch.calls[1]).toContain("q_track=Yellow&q_artist=Coldplay&q_duration=269");

    // The token is cached, so the next search asks for no new one.
    expect(await musixmatch(yellow, fetch, options)).not.toBeNull();
    expect(tokenCalls(fetch)).toHaveLength(1);
    expect(macroCalls(fetch)).toHaveLength(2);
  });

  test("auto: refreshes a stale token on 401 and retries once", async () => {
    let tokens = 0;
    let attempts = 0;
    const fetch = mockFetch([
      [/token\.get/, () => tokenAnswer("mobile-token-" + ++tokens)],
      [/macro\.subtitles\.get/, () => (attempts++ === 0 ? rejected : yellowAnswer())],
    ]);
    const result = await musixmatch(yellow, fetch, options);
    expect(result?.title).toBe("Yellow");
    expect(tokenCalls(fetch)).toHaveLength(2);
    expect(macroCalls(fetch)).toHaveLength(2);
    expect(fetch.calls[1]).toContain("usertoken=mobile-token-1");
    expect(fetch.calls[3]).toContain("usertoken=mobile-token-2");
  });

  test("auto: reports a rejection when the refreshed token is rejected too", async () => {
    let tokens = 0;
    const fetch = mockFetch([
      [/token\.get/, () => tokenAnswer("mobile-token-" + ++tokens)],
      [/macro\.subtitles\.get/, rejected],
    ]);
    await expect(musixmatch(yellow, fetch, options)).rejects.toThrow(/rejected/);
    // Retried once, not in a loop.
    expect(tokenCalls(fetch)).toHaveLength(2);
    expect(macroCalls(fetch)).toHaveLength(2);
  });

  test("auto: refuses the all-zero token Musixmatch hands out when it has none", async () => {
    expect(isUsableToken(musixmatchToken.message.body.user_token)).toBe(false);
    const fetch = mockFetch([[/token\.get/, musixmatchToken]]);
    await expect(musixmatch(yellow, fetch, options)).rejects.toThrow(/user token/);
    // The useless token is remembered for a minute instead of asking again for every track.
    await expect(musixmatch(yellow, fetch, options)).rejects.toThrow(/user token/);
    expect(tokenCalls(fetch)).toHaveLength(1);
    expect(macroCalls(fetch)).toHaveLength(0);
  });

  test("user: sends the configured token without asking for one", async () => {
    const fetch = mockFetch([
      [/macro\.subtitles\.get/, yellowAnswer()],
      [/token\.get/, musixmatchMobileToken],
    ]);
    const result = await musixmatch(yellow, fetch, { ...options, tokenMode: "user", userToken: " 2501abc " });
    expect(result?.title).toBe("Yellow");
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]).toContain("usertoken=2501abc");
    expect(tokenCalls(fetch)).toHaveLength(0);
  });

  test("user: tells when the token is rejected and keeps to the user token", async () => {
    const fetch = mockFetch([
      [/macro\.subtitles\.get/, rejected],
      [/token\.get/, musixmatchMobileToken],
    ]);
    await expect(musixmatch(yellow, fetch, { ...options, tokenMode: "user", userToken: "2501abc" })).rejects.toThrow(/rejected/);
    expect(macroCalls(fetch)).toHaveLength(1);
    expect(tokenCalls(fetch)).toHaveLength(0);
  });

  test("user: asks for a token in the settings when none is set", async () => {
    const fetch = mockFetch([]);
    await expect(musixmatch(yellow, fetch, { ...options, tokenMode: "user", userToken: " " })).rejects.toThrow(/user token/);
    expect(fetch.calls).toHaveLength(0);
  });

  test("rejects the decoy track and handles calls without results", () => {
    // Asked for Coldplay's Yellow, it "found" another song with made-up lyrics.
    const decoy = musixmatchDecoy.message.body.macro_calls["matcher.track.get"].message.body.track;
    expect([decoy.track_name, decoy.artist_name]).toEqual(["NOKIA", "Drake"]);
    expect(parseMacro(musixmatchDecoy, yellow)).toBeNull();
    const empty = { message: { header: { status_code: 200 }, body: { macro_calls: { "matcher.track.get": { message: { body: [] } } } } } };
    expect(parseMacro(empty, yellow)).toBeNull();
  });
});

describe("netease", () => {
  const routes = (): [RegExp, unknown][] => [
    [/\/register\/anonimous/, { code: 200 }],
    [
      /\/search\/song\/list\/page/,
      {
        code: 200,
        data: {
          resources: [
            { resourceId: 1, baseInfo: { simpleSongData: { name: "Wrong Song", ar: [{ id: 1, name: "Someone" }], dt: 200_000 } } },
            { resourceId: 2, baseInfo: { simpleSongData: { name: "Song (Live)", ar: [{ id: 2, name: "Artist" }], dt: 201_000 } } },
            { resourceId: 3, baseInfo: { simpleSongData: { name: "Song", ar: [{ id: 2, name: "Artist" }], dt: 400_000 } } },
          ],
        },
      },
    ],
    [
      /\/song\/lyric\/v1/,
      {
        code: 200,
        lrc: { lyric: "[00:01.00]hello\n[00:02.00]world" },
        tlyric: { lyric: "[00:01.00]你好\n[00:02.00]世界" },
        romalrc: { lyric: "[00:01.00]nihao\n[00:02.00]shijie" },
      },
    ],
  ];

  test("matches by title, artist and duration, and attaches official translations", async () => {
    resetNeteaseSession();
    const fetch = mockFetch(routes());
    const result = await netease({ ...query, title: "Song", artist: "Artist", durationSeconds: 200 }, fetch);

    expect(result?.title).toBe("Song (Live)");
    expect(result?.lines?.map((line) => line.text)).toEqual(["", "hello", "world"]);
    expect(result?.translation?.lines?.map((line) => line.text)).toEqual(["", "你好", "世界"]);
    expect(result?.romanization?.filter(Boolean)).toEqual(["nihao", "shijie"]);
    expect(fetch.calls.some((call) => call.includes("/song/lyric/v1"))).toBe(true);
  });

  test("skips every candidate when none is close enough in duration", async () => {
    resetNeteaseSession();
    const fetch = mockFetch(routes());
    expect(await netease({ ...query, title: "Song", artist: "Artist", durationSeconds: 100 }, fetch)).toBeNull();
    expect(fetch.calls.some((call) => call.includes("/song/lyric/v1"))).toBe(false);
  });

  test("answers null for malformed or empty search responses", async () => {
    resetNeteaseSession();
    expect(
      await netease(
        query,
        mockFetch([
          [/\/register\/anonimous/, { code: 200 }],
          [/search/, "not json"],
        ]),
      ),
    ).toBeNull();
    expect(parseSearchResponse({ code: 200, data: { resources: null } })).toEqual([]);
  });

  test("scores titles across scripts and picks the original CJK title", () => {
    expect(splitTitle("Song (Live)")).toEqual(["Song"]);
    expect(pickOriginalTitle("Pretender", "プリテンダー")).toBe("プリテンダー");
    expect(scoreCandidate({ title: "Song", artists: ["Artist"] }, buildQuery("Song", "Artist"))).toBeGreaterThan(10);
    expect(scoreCandidate({ title: "Paradise", artists: ["Coldplay"] }, buildQuery("Song", "Artist"))).toBeLessThan(4.5);
  });
});
