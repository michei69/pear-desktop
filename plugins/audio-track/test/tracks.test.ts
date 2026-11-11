import type { YTPlayerApi, YTPlayerAudioTrack } from "@pear/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  desiredTrack,
  pickerChoices,
  pickerIndex,
  findOriginalTrack,
  isAutoDubbed,
  isOriginalTrack,
  readCurrentTrackId,
  readTracks,
  trackId,
  trackName,
} from "../tracks.ts";

/** A track in the language-info shape. */
const info = (id: string, name: string, options: { isDefault?: boolean; autoDubbed?: boolean } = {}) =>
  ({
    getLanguageInfo: () => ({
      getId: () => id,
      getName: () => name,
      getIsDefault: () => options.isDefault ?? false,
      getIsAutoDubbed: () => options.autoDubbed ?? false,
    }),
  }) satisfies YTPlayerAudioTrack;

/** A track in the protobuf shape (no accessors). */
const pb = (id: string, name: string, options: { isDefault?: boolean; isAutoDubbed?: boolean } = {}) =>
  ({ Pb: { id, name, ...options } }) as YTPlayerAudioTrack;

describe("track identity", () => {
  it("reads the id and name from whichever shape the player build exposes", () => {
    expect(trackId(info("en", "English"))).toBe("en");
    expect(trackId(pb("de", "German"))).toBe("de");
    expect(trackId({ id: "plain" } as YTPlayerAudioTrack)).toBe("plain");
    // Language info beats the protobuf field, which beats the plain id.
    expect(trackId({ id: "plain", Pb: { id: "pb" }, getLanguageInfo: () => ({ getId: () => "info" }) as never })).toBe("info");
    expect(trackId({} as YTPlayerAudioTrack)).toBe("");
    expect(trackName(info("en", "English"))).toBe("English");
    expect(trackName(pb("de", "German"))).toBe("German");
    // The id is the last resort, as pear-desktop did.
    expect(trackName({ id: "plain" } as YTPlayerAudioTrack)).toBe("plain");
  });

  it("tells auto-dubs and the original track apart", () => {
    expect(isAutoDubbed(info("en", "English", { autoDubbed: true }))).toBe(true);
    expect(isAutoDubbed(pb("en", "English", { isAutoDubbed: true }))).toBe(true);
    expect(isAutoDubbed({ isAutoDubbed: () => true } as YTPlayerAudioTrack)).toBe(true);
    expect(isAutoDubbed(info("en", "English"))).toBe(false);

    expect(isOriginalTrack(info("en", "English", { isDefault: true }))).toBe(true);
    // A dub of the default track is not the original.
    expect(isOriginalTrack(info("en", "English", { isDefault: true, autoDubbed: true }))).toBe(false);
    expect(isOriginalTrack(pb("en", "English", { isDefault: true }))).toBe(true);
  });
});

describe("chooseTrack", () => {
  const original = info("en", "English", { isDefault: true });
  const dub = info("es", "Spanish (auto-dubbed)", { autoDubbed: true });
  const other = info("fr", "French");
  const tracks = [dub, original, other];

  it("takes the default non-dub track as the original, else the first non-dub", () => {
    expect(findOriginalTrack(tracks)).toBe(original);
    expect(findOriginalTrack([dub, other])).toBe(other);
    expect(findOriginalTrack([dub])).toBeUndefined();
    expect(findOriginalTrack([])).toBeUndefined();
  });

  it("prefers the picked track while the video offers it", () => {
    expect(desiredTrack(tracks, "fr", true)).toBe(other);
    expect(desiredTrack(tracks, "fr", false)).toBe(other);
  });

  it("falls back to the original only while preferOriginal is on", () => {
    // A pick from another video is not on this one.
    expect(desiredTrack(tracks, "ja", true)).toBe(original);
    expect(desiredTrack(tracks, "ja", false)).toBeUndefined();
    expect(desiredTrack(tracks, "", true)).toBe(original);
    expect(desiredTrack(tracks, "", false)).toBeUndefined();
  });
});

describe("picker index", () => {
  const original = info("en", "English", { isDefault: true });
  const dub = info("es", "Spanish (auto-dubbed)", { autoDubbed: true });
  const tracks = [dub, original];

  it("is the track's button position plus one", () => {
    expect(pickerIndex(tracks, "en")).toBe(2);
    expect(pickerIndex(tracks, "es")).toBe(1);
  });

  it("falls back to Automatic, never to the first track", () => {
    // An unknown id (a pick from another video) and an unknown current track both
    // mean "no track is selected", so the dialog must not default to the first one.
    expect(pickerIndex(tracks, "ja")).toBe(0);
    expect(pickerIndex(tracks, "")).toBe(0);
    expect(pickerIndex([], "")).toBe(0);
  });
});

describe("picker choices", () => {
  const first = info("en", "English");
  const middle = info("es", "Spanish");
  const last = info("fr", "French");
  const tracks = [first, middle, last];
  const checked = (currentId: string) => pickerChoices(tracks, currentId).tracks.filter((choice) => choice.checked);

  it("marks Automatic when the player cannot name a track", () => {
    expect(pickerChoices(tracks, "").automatic).toBe(true);
    expect(pickerChoices(tracks, "ja").automatic).toBe(true);
    expect(checked("")).toEqual([]);
  });

  it("marks the playing track, at any position", () => {
    // The list is 1-based (0 is Automatic), so the first track is row 1, not row 0.
    expect(checked("en").map((choice) => choice.index)).toEqual([1]);
    expect(checked("es").map((choice) => choice.index)).toEqual([2]);
    expect(checked("fr").map((choice) => choice.index)).toEqual([3]);
    expect(pickerChoices(tracks, "es").automatic).toBe(false);
    expect(checked("es").map((choice) => choice.label)).toEqual(["Spanish"]);
  });
});

describe("player reads", () => {
  it("answers an empty list and an empty id instead of throwing", () => {
    expect(readTracks({} as YTPlayerApi)).toEqual([]);
    expect(
      readTracks({
        getAvailableAudioTracks: () => {
          throw new Error("no player");
        },
      } as never),
    ).toEqual([]);
    expect(readCurrentTrackId({} as YTPlayerApi)).toBe("");
    expect(
      readCurrentTrackId({
        getAudioTrack: () => {
          throw new Error("no player");
        },
      } as never),
    ).toBe("");
    const track = info("en", "English");
    expect(readCurrentTrackId({ getAudioTrack: () => track } as never)).toBe("en");
  });

  it("calls the optional player hooks only when they exist", () => {
    const getAvailableAudioTracks = vi.fn(() => [info("en", "English")]);
    expect(readTracks({ getAvailableAudioTracks } as never)).toHaveLength(1);
    expect(getAvailableAudioTracks).toHaveBeenCalledOnce();
  });
});
