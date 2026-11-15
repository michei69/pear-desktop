import { describe, expect, test } from "vitest";
import { buildSegmentsGradient, CATEGORY_COLORS, categoryLabel, markerAt, type Marker, usableMarkers } from "../markers.ts";
import type { Segment, Submission } from "../segments.ts";

const marker = (segment: Segment, category = "sponsor"): Marker => ({ segment, category });

const submission = (segment: Segment, category: string, extra: Partial<Submission> = {}): Submission => ({
  segment,
  category,
  actionType: "skip",
  videoDuration: 300,
  ...extra,
});

describe("buildSegmentsGradient", () => {
  test("paints one hard-stop run per segment", () => {
    expect(buildSegmentsGradient([marker([30, 50])], 300)).toBe(
      "linear-gradient(to right, transparent 10.00%, #00d400 10.00%, #00d400 16.67%, transparent 16.67%)",
    );
  });

  test("sorts markers so gradient stops never go backwards", () => {
    expect(buildSegmentsGradient([marker([150, 180], "music_offtopic"), marker([30, 50], "sponsor")], 300)).toBe(
      "linear-gradient(to right, transparent 10.00%, #00d400 10.00%, #00d400 16.67%, transparent 16.67%, transparent 50.00%, #ff9900 50.00%, #ff9900 60.00%, transparent 60.00%)",
    );
  });

  test("clamps segments to the track and drops ones outside it", () => {
    expect(buildSegmentsGradient([marker([-10, 30], "intro")], 300)).toBe(
      "linear-gradient(to right, transparent 0.00%, #00ffff 0.00%, #00ffff 10.00%, transparent 10.00%)",
    );
    expect(buildSegmentsGradient([marker([320, 400], "outro")], 300)).toBe("");
  });

  test("unknown categories fall back to the sponsor colour", () => {
    expect(buildSegmentsGradient([marker([0, 30], "unknown")], 300)).toContain(CATEGORY_COLORS.sponsor);
  });

  test("draws nothing without segments or a usable duration", () => {
    const markers = [marker([30, 50])];
    expect(buildSegmentsGradient([], 300)).toBe("");
    expect(buildSegmentsGradient(markers, 0)).toBe("");
    expect(buildSegmentsGradient(markers, Number.NaN)).toBe("");
    expect(buildSegmentsGradient(markers, Number.POSITIVE_INFINITY)).toBe("");
  });

  test("leaves the input untouched", () => {
    const markers = [marker([150, 180], "music_offtopic"), marker([30, 50])];
    buildSegmentsGradient(markers, 300);
    expect(markers.map(({ segment }) => segment)).toEqual([
      [150, 180],
      [30, 50],
    ]);
  });
});

describe("usableMarkers", () => {
  test("keeps usable submissions with their categories, sorted by start", () => {
    const submissions = [submission([150, 180], "music_offtopic"), submission([30, 50], "sponsor"), submission([0, 10], "intro")];
    expect(usableMarkers(submissions, 300)).toEqual([
      { segment: [0, 10], category: "intro" },
      { segment: [30, 50], category: "sponsor" },
      { segment: [150, 180], category: "music_offtopic" },
    ]);
  });

  test("filters another cut's submissions once the duration is known", () => {
    expect(usableMarkers([submission([30, 50], "sponsor"), submission([10, 20], "intro", { videoDuration: 240 })], 300)).toEqual([
      { segment: [30, 50], category: "sponsor" },
    ]);
  });

  test("trusts submissions while the duration is unknown", () => {
    expect(usableMarkers([submission([10, 20], "intro", { videoDuration: 240 })], 0)).toEqual([{ segment: [10, 20], category: "intro" }]);
  });
});

describe("markerAt", () => {
  // usableMarkers sorts by start, which is the order the hover lookup receives.
  const markers = [marker([0, 100], "sponsor"), marker([20, 40], "outro")];

  test("finds the topmost marker under a time", () => {
    expect(markerAt(markers, 0)?.category).toBe("sponsor");
    expect(markerAt(markers, 30)?.category).toBe("outro");
    expect(markerAt(markers, 50)?.category).toBe("sponsor");
    expect(markerAt(markers, 100)).toBeUndefined();
    expect(markerAt(markers, -1)).toBeUndefined();
    expect(markerAt([], 10)).toBeUndefined();
  });
});

describe("categoryLabel", () => {
  /** A catalog-backed `ctx.t`: returns the translation or the fallback. */
  const translate = (strings: Record<string, string>) => (key: string, fallback?: string) => strings[key] ?? fallback ?? key;

  test("prefers the generated settings label", () => {
    const t = translate({
      "plugins.sponsorblock.settings.preview.label": "Vorschauen",
      "plugins.sponsorblock.settings.category.preview": "Legacy",
    });
    expect(categoryLabel(t, "preview", "Previews and recaps")).toBe("Vorschauen");
  });

  test("falls back to master's legacy category key", () => {
    const t = translate({ "plugins.sponsorblock.settings.category.sponsor": "Sponsor" });
    expect(categoryLabel(t, "sponsor", "Sponsors")).toBe("Sponsor");
  });

  test("falls back to the English label", () => {
    expect(categoryLabel(translate({}), "filler", "Filler tangents")).toBe("Filler tangents");
  });
});
