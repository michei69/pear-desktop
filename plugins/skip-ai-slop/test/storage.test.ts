import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRecent, readRecentFiltered, recordFiltered, removeRecent } from "../storage.ts";

let storage: Map<string, string>;

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  // The module keeps its parsed stores between calls; start every test empty.
  clearRecent();
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
