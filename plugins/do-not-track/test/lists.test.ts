import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  BUILTIN_SOURCES,
  cachedSources,
  chooseLists,
  fetchSources,
  loadLocalLists,
  parseSources,
  SOURCES_URL,
  type ListOptions,
} from "../lists.ts";

const dir = mkdtempSync(join(tmpdir(), "pear-dnt-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const options = (patch: Partial<ListOptions> = {}): ListOptions => ({
  profile: "Balanced",
  customEnabled: false,
  disableDefaultLists: false,
  additionalBlockLists: [],
  additionalBlockListRules: [],
  ...patch,
});

describe("blocklists", () => {
  test("reads tb.json, skipping what isn't a URL", () => {
    expect(parseSources({ tb: ["https://a.example/list.txt", 5, "not a url"] })).toEqual(["https://a.example/list.txt"]);
    expect(parseSources({ tb: [] })).toBeUndefined();
    expect(parseSources({ lists: [] })).toBeUndefined();
    expect(parseSources(null)).toBeUndefined();
  });

  test("each profile loads its own bundled lists", () => {
    expect(chooseLists([], [], options({ profile: "Lite" }))).toEqual([]);
    expect(chooseLists([], [], options()).map((list) => list.url)).toEqual(["builtin-blocklist://balanced"]);
    expect(chooseLists([], [], options({ profile: "Strict" })).map((list) => list.url)).toEqual([
      "builtin-blocklist://balanced",
      "builtin-blocklist://strict-addon",
    ]);
    expect(chooseLists([], [], options()).every((list) => list.contents?.includes("music.\u0079outube.com"))).toBe(true);
  });

  test("combines the curated and the user's lists only with custom lists on", () => {
    const curated = ["https://a.example/1.txt", "https://a.example/2.txt"];
    const own = [" https://b.example/mine.txt ", "https://a.example/1.txt", "nonsense"];
    expect(chooseLists(curated, [], options()).map((list) => list.url)).toEqual(["builtin-blocklist://balanced"]);
    expect(chooseLists(curated, [], options({ customEnabled: true, additionalBlockLists: own })).map((list) => list.url)).toEqual([
      "https://a.example/1.txt",
      "https://a.example/2.txt",
      "https://b.example/mine.txt",
      "builtin-blocklist://balanced",
    ]);
    expect(
      chooseLists(curated, [], options({ customEnabled: true, disableDefaultLists: true, additionalBlockLists: own })).map(
        (list) => list.url,
      ),
    ).toEqual(["https://b.example/mine.txt", "https://a.example/1.txt", "builtin-blocklist://balanced"]);
  });

  test("adds local lists and inline rules", () => {
    const local = [{ url: "local-blocklist://file/mine.txt", contents: "||local.example^" }];
    const lists = chooseLists([], local, options({ customEnabled: true, additionalBlockListRules: ["$removeparam=/^utm_/"] }));
    expect(lists.map((list) => list.url)).toEqual([
      "local-blocklist://file/mine.txt",
      "builtin-blocklist://balanced",
      "local-blocklist://inline-rules",
    ]);
    expect(lists[2]!.contents).toContain("*$removeparam=utm_source");
  });

  test("skips disabled local list files", async () => {
    const local = join(dir, "blocklists");
    mkdirSync(local, { recursive: true });
    writeFileSync(join(local, "a.txt"), "||a.example^");
    writeFileSync(join(local, "b.txt"), "||b.example^");
    expect((await loadLocalLists(local, ["b.txt"])).map((list) => list.url)).toEqual(["local-blocklist://file/a.txt"]);
  });

  test("remembers fetched lists and falls back to the built-in copy", async () => {
    expect(await cachedSources(dir)).toBe(BUILTIN_SOURCES);
    const fetched: string[] = [];
    const fetch = async (url: string) => (fetched.push(url), Response.json({ tb: ["https://c.example/new.txt"] }));
    expect(await fetchSources(fetch, dir)).toEqual(["https://c.example/new.txt"]);
    expect(fetched).toEqual([SOURCES_URL]);
    expect(JSON.parse(readFileSync(join(dir, "tb.json"), "utf8"))).toEqual({
      tb: ["https://c.example/new.txt"],
    });
    expect(await cachedSources(dir)).toEqual(["https://c.example/new.txt"]);

    expect(await fetchSources(async () => new Response("down", { status: 503 }), dir)).toBeUndefined();
    expect(await fetchSources(async () => Promise.reject(new Error("offline")), dir)).toBeUndefined();
    expect(await cachedSources(dir)).toEqual(["https://c.example/new.txt"]);
  });
});
