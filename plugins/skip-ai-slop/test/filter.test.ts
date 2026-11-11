import { describe, expect, it } from "vitest";
import {
  type Blacklist,
  type CardIdentity,
  type RuleSource,
  buildRules,
  compileKeywords,
  decide,
  decideEarly,
  normalizeKeywords,
} from "../filter.ts";

const source = (patch: Partial<RuleSource> = {}): RuleSource => ({
  userAllow: [],
  userBlock: [],
  keywords: [],
  communityList: false,
  ...patch,
});

/** A channel id is "UC" plus 22 characters; a track id is 11. */
const channel = (suffix: string) => `UC${suffix.padEnd(22, "a")}`;
const track = (suffix: string) => suffix.padEnd(11, "0").slice(0, 11);

const rulesOf = (patch: Partial<RuleSource> = {}, list: Blacklist | null = null, session = new Set<string>()) =>
  buildRules(source(patch), list, session);

const card = (patch: Partial<CardIdentity> = {}): CardIdentity => ({
  videoId: track("v1"),
  channelIds: [],
  title: "A Song",
  author: "An Artist",
  ...patch,
});

const blacklist = (channels: string[], tracks: string[]): Blacklist => ({
  version: 2,
  updated_at: "2026-11-08",
  channels: Object.fromEntries(channels.map((id) => [id, {}])),
  tracks: Object.fromEntries(tracks.map((id) => [id, {}])),
});

describe("normalizeKeywords", () => {
  it("accepts both the current and the older plain-string form", () => {
    expect(normalizeKeywords(["ai cover", { text: "slop", enabled: false }])).toEqual([
      { text: "ai cover", enabled: true },
      { text: "slop", enabled: false },
    ]);
    // `enabled` only reads as false when it is exactly false.
    expect(normalizeKeywords([{ text: "x", enabled: 0 }])).toEqual([{ text: "x", enabled: true }]);
  });

  it("skips anything without usable text", () => {
    expect(normalizeKeywords(["   ", { text: "  " }, {}, null, 5, []])).toEqual([]);
    expect(normalizeKeywords(undefined)).toEqual([]);
    expect(normalizeKeywords("not an array")).toEqual([]);
  });
});

describe("compileKeywords", () => {
  it("matches a whole word, not a fragment of one", () => {
    const [ai] = compileKeywords(["ai"]);

    expect(ai?.test("AI Cover")).toBe(true);
    expect(ai?.test("Mai Tai")).toBe(false);
    expect(ai?.test("Tchaikovsky")).toBe(false);
  });

  it("matches a multi-word keyword across any whitespace", () => {
    const [cover] = compileKeywords(["ai cover"]);

    expect(cover?.test("AI Cover")).toBe(true);
    expect(cover?.test("ai   cover")).toBe(true);
    expect(cover?.test("AI Coverband")).toBe(false);
  });

  it("matches keyword text literally, regex characters included", () => {
    const [cpp] = compileKeywords(["c++"]);
    const [dotted] = compileKeywords(["lo.fi"]);

    expect(cpp?.test("C++ tutorial")).toBe(true);
    expect(cpp?.test("CXX tutorial")).toBe(false);
    expect(dotted?.test("lo.fi beats")).toBe(true);
    // The `.` is escaped, so it cannot stand in for any character.
    expect(dotted?.test("loXfi beats")).toBe(false);
  });

  it("compiles only enabled keywords", () => {
    expect(compileKeywords([{ text: "slop", enabled: false }])).toEqual([]);
    expect(compileKeywords(["   "])).toEqual([]);
    expect(compileKeywords(undefined)).toEqual([]);
  });
});

describe("buildRules", () => {
  it("splits the settings lists into ids and lower-cased exact names", () => {
    const allow = channel("allow");
    const rules = rulesOf({ userAllow: [allow, "  Real Name  ", ""], userBlock: [track("blocked"), "Other Band"] });

    expect(rules.allowIds).toEqual(new Set([allow]));
    expect(rules.allowNames).toEqual(new Set(["real name"]));
    expect(rules.blockIds).toEqual(new Set([track("blocked")]));
    expect(rules.blockNames).toEqual(new Set(["other band"]));
  });

  it("keeps the learned-artist session and the community list separate", () => {
    const session = new Set([channel("learnt")]);
    const rules = buildRules(source(), null, session);

    expect(rules.session).toBe(session);
    expect(rules.channels.size).toBe(0);
    expect(rules.tracks.size).toBe(0);
  });
});

describe("decide", () => {
  it("lets Allow win over blocks and keywords", () => {
    const allowed = channel("allowed");
    const rules = rulesOf({ userAllow: [allowed], userBlock: [allowed], keywords: ["ai"] });

    expect(decide(rules, card({ channelIds: [allowed], title: "AI Cover", author: "AI Band" }))).toBeNull();
  });

  it("blocks by channel id and by exact name", () => {
    const blocked = channel("blocked");
    expect(decide(rulesOf({ userBlock: [blocked] }), card({ channelIds: [blocked] }))).toBe("user-block");
    expect(decide(rulesOf({ userBlock: ["An Artist"] }), card())).toBe("user-block");
  });

  it("flags keywords in the title and in the author", () => {
    const rules = rulesOf({ keywords: ["ai"] });

    expect(decide(rules, card({ title: "AI Cover" }))).toBe("keyword:title");
    expect(decide(rules, card({ author: "AI Band" }))).toBe("keyword:author");
    expect(decide(rules, card({ title: "Mai Tai" }))).toBeNull();
  });

  it("flags the community list's channels and tracks", () => {
    const listed = channel("listed");
    const list = blacklist([listed], [track("t1")]);
    const rules = rulesOf({ communityList: true }, list);
    expect(decide(rules, card({ videoId: track("v2"), channelIds: [listed] }))).toBe("channel");
    expect(decide(rules, card({ videoId: track("t1") }))).toBe("track");
    // The list is only used while the switch is on.
    expect(decide(rulesOf({}, list), card({ channelIds: [listed] }))).toBeNull();
  });

  it("blocks exactly one track by its video id", () => {
    const blockedTrack = track("blocked");
    const rules = rulesOf({ userBlock: [blockedTrack] });

    expect(decide(rules, card({ videoId: blockedTrack }))).toBe("user-block");
    expect(decide(rules, card({ videoId: track("other") }))).toBeNull();
  });

  it("flags artists learned in this session", () => {
    const learnt = channel("learnt");
    expect(decide(rulesOf({}, null, new Set([learnt])), card({ channelIds: [learnt] }))).toBe("learned-artist");
  });

  it("allows exactly one track by its video id", () => {
    const allowedTrack = track("allowed");
    const otherTrack = track("other");
    const blocked = channel("blocked");
    const rules = rulesOf({ userAllow: [allowedTrack], userBlock: [blocked], keywords: ["slop"] });

    // The allow list wins for that one track, even over a keyword and its channel.
    expect(decide(rules, card({ videoId: allowedTrack, channelIds: [blocked], title: "Slop", author: "Slop" }))).toBeNull();
    // Nothing else is allowed by a track id.
    expect(decide(rules, card({ videoId: otherTrack, channelIds: [], title: "Slop", author: "" }))).toBe("keyword:title");
  });
});

describe("decideEarly", () => {
  it("answers from the links and texts alone", () => {
    const blocked = channel("blocked");
    const rules = rulesOf({ userBlock: [blocked], keywords: ["ai"] });

    expect(decideEarly(rules, { videoIds: [], channelIds: [blocked], texts: [] })).toBe("user-block");
    expect(decideEarly(rules, { videoIds: [], channelIds: [], texts: ["AI Cover"] })).toBe("keyword");
    expect(decideEarly(rules, { videoIds: [], channelIds: [], texts: ["A Song"] })).toBeNull();
  });

  it("allows by id and by exact name, and flags community entries", () => {
    const allowedTrack = track("allowed");
    const listed = channel("listed");
    const list = blacklist([listed], []);

    expect(decideEarly(rulesOf({ userAllow: [allowedTrack] }), { videoIds: [allowedTrack], channelIds: [], texts: [] })).toBeNull();
    expect(decideEarly(rulesOf({ userAllow: ["An Artist"] }), { videoIds: [], channelIds: [], texts: ["An Artist"] })).toBeNull();
    expect(decideEarly(rulesOf({ communityList: true }, list), { videoIds: [], channelIds: [listed], texts: [] })).toBe("channel");
  });
});
