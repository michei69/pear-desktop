import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearBlacklistNames,
  clearRecent,
  readRecentFiltered,
  recordFiltered,
  removeRecent,
  searchBlacklistNames,
  writeBlacklistNames,
} from "../storage.ts";

const channel = (suffix: string) => `UC${suffix.padEnd(22, "a")}`;

let storage: Map<string, string>;

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  // The module keeps its parsed stores between calls; start every test empty.
  clearBlacklistNames();
  clearRecent();
});

describe("searchBlacklistNames", () => {
  it("hands back name-prefix matches first, then name matches, then id matches, with the total", () => {
    writeBlacklistNames({
      channels: {
        [channel("alpha")]: { name: "Alpha" },
        [channel("alphabet")]: { name: "Alphabet" },
        [channel("the")]: { name: "The Alpha" },
        // Its name does not hold the query, only the id does.
        [`UCzalpha${"a".repeat(16)}`]: { name: "Zeta" },
      },
      tracks: { "alpha-song": { title: "Alpha Song" } },
    });

    const { matches, total } = searchBlacklistNames("alpha", 2);
    expect(matches.map((entry) => entry.name)).toEqual(["Alpha", "Alpha Song"]);
    expect(total).toBe(5);

    // Name-prefix matches first, then other name matches, then id-only matches.
    expect(searchBlacklistNames("alpha").matches.map((entry) => entry.name)).toEqual([
      "Alpha",
      "Alpha Song",
      "Alphabet",
      "The Alpha",
      "Zeta",
    ]);
  });

  it("has no matches for an empty query", () => {
    expect(searchBlacklistNames("  ")).toEqual({ matches: [], total: 0 });
  });
});

describe("removeRecent", () => {
  it("forgets one recent match and keeps the rest, in order", () => {
    recordFiltered({ id: "a", name: "A", reason: "keyword:title" });
    recordFiltered({ id: "b", name: "B", reason: "channel" });

    removeRecent("a");
    expect(readRecentFiltered().map((entry) => entry.id)).toEqual(["b"]);

    removeRecent("b");
    expect(readRecentFiltered()).toEqual([]);
  });
});
