import { describe, expect, it } from "vitest";
import { filterRows, matchesTitle, needsApply } from "../filter.ts";

/** A row with an inline display, like the renderers the plugin filters. */
const row = (title: string) => ({ title, style: { display: "" } });

describe("title matching", () => {
  it("matches a substring of the lowercased title", () => {
    expect(matchesTitle("Road Trip", "trip")).toBe(true);
    // The term is lowercased once by the caller, the title here.
    expect(matchesTitle("Road Trip", "road t")).toBe(true);
    expect(matchesTitle("Road Trip", "chill")).toBe(false);
  });

  it("shows every row for an empty term", () => {
    expect(matchesTitle("Anything", "")).toBe(true);
  });
});

describe("row filtering", () => {
  it("hides the rows that don't match and reports the visible count", () => {
    const rows = [row("Road Trip"), row("Chill"), row("Road to Nowhere")];
    expect(filterRows(rows, "road", (entry) => entry.title)).toBe(2);
    expect(rows.map((entry) => entry.style.display)).toEqual(["", "none", ""]);
  });

  it("restores the rows when the term is cleared", () => {
    const rows = [row("Road Trip"), row("Chill")];
    filterRows(rows, "road", (entry) => entry.title);
    expect(rows[1]?.style.display).toBe("none");
    expect(filterRows(rows, "", (entry) => entry.title)).toBe(2);
    expect(rows.map((entry) => entry.style.display)).toEqual(["", ""]);
  });
});

describe("scheduled passes", () => {
  it("does nothing while the box is empty and nothing is filtered", () => {
    // YTM's DOM churn schedules a pass up to every 50 ms; this must stay cheap.
    expect(needsApply("", false)).toBe(false);
  });

  it("restores rows after a term was applied, and filters a new one", () => {
    expect(needsApply("", true)).toBe(true);
    expect(needsApply("road", false)).toBe(true);
    expect(needsApply("road", true)).toBe(true);
  });
});
