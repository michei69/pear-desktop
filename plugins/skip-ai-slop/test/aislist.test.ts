import { describe, expect, it } from "vitest";
import { type Blacklist, type RuleSource, buildRules, decide, decideEarly, mergeAisList, parseAisList } from "../filter.ts";

const channel = (suffix: string) => `UC${suffix.padEnd(22, "a")}`;

const source = (patch: Partial<RuleSource> = {}): RuleSource => ({
  userAllow: [],
  userBlock: [],
  keywords: [],
  communityList: true,
  ...patch,
});

const blacklist = (): Blacklist => ({
  version: 2,
  updated_at: "2026-11-17",
  channels: { [channel("json")]: { name: "From JSON" } },
  tracks: { "track0000001": { title: "A track" } },
});

describe("parseAisList", () => {
  it("keeps handles and ignores comments and blank lines", () => {
    const text = "! header\n@GoodHandle\r\n\n  @Spaced  \n! Total: 2\n";
    expect(parseAisList(text)).toEqual(["@GoodHandle", "@Spaced"]);
  });

  it("keeps channel ids too, but never the warn list's text", () => {
    expect(parseAisList(`@One\n${channel("id")}\n`)).toEqual(["@One", channel("id")]);
  });
});

describe("mergeAisList", () => {
  it("adds handles without dropping the JSON list's channels or tracks", () => {
    const merged = mergeAisList(blacklist(), ["@GoodHandle"]);
    expect(Object.keys(merged.channels)).toEqual([channel("json"), "@GoodHandle"]);
    expect(merged.tracks).toEqual(blacklist().tracks);
    expect(merged.channels["@GoodHandle"]).toEqual({});
  });

  it("does not duplicate a handle already present", () => {
    const merged = mergeAisList(blacklist(), ["@GoodHandle", "@GoodHandle"]);
    expect(Object.keys(merged.channels).filter((key) => key === "@GoodHandle")).toHaveLength(1);
  });
});

describe("handle matching", () => {
  const list = mergeAisList(blacklist(), ["@GoodHandle"]);
  const card = { videoId: undefined, channelIds: [], title: "A song", author: "GoodHandle" };

  it("flags a card whose name equals a listed handle", () => {
    expect(decide(buildRules(source(), list), card)).toBe("channel");
    expect(decide(buildRules(source(), list), { ...card, author: "Other", title: "GoodHandle" })).toBe("channel");
    expect(decide(buildRules(source(), list), { ...card, author: "Not Listed" })).toBeNull();
  });

  it("does not match without the community-list switch", () => {
    expect(decide(buildRules(source({ communityList: false }), list), card)).toBeNull();
  });

  it("lets an allowed handle win", () => {
    const rules = buildRules(source({ userAllow: ["@GoodHandle"] }), list);
    expect(decide(rules, card)).toBeNull();
  });

  it("matches handle texts in the pre-paint scan", () => {
    const rules = buildRules(source(), list);
    expect(decideEarly(rules, { videoIds: [], channelIds: [], texts: ["@GoodHandle"] })).toBe("channel");
    expect(decideEarly(rules, { videoIds: [], channelIds: [], texts: ["GoodHandle"] })).toBe("channel");
  });
});
