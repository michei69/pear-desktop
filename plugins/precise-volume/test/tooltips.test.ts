import { describe, expect, test } from "vitest";
import { VolumeTitles } from "../tooltips.ts";

/** The parts of a volume element the tooltip code touches, with real attributes. */
function element(title?: string) {
  const attributes = new Map<string, string>();
  if (title !== undefined) attributes.set("title", title);
  return {
    get title() {
      return attributes.get("title") ?? "";
    },
    set title(value: string) {
      attributes.set("title", value);
    },
    getAttribute: (name: string) => attributes.get(name) ?? null,
    removeAttribute: (name: string) => void attributes.delete(name),
  } as unknown as HTMLElement;
}

describe("volume tooltips", () => {
  test("writes the volume and puts YTM's own titles back on stop", () => {
    const slider = element("Volume: 100");
    const button = element();
    const titles = new VolumeTitles();
    titles.set(slider, 42);
    titles.set(button, 42);
    expect(slider.title).toBe("42%");
    expect(button.title).toBe("42%");
    // Only the first title is YTM's; later writes are the plugin's own.
    titles.set(slider, 37);
    titles.restore();
    expect(slider.title).toBe("Volume: 100");
    expect(button.getAttribute("title")).toBeNull();
  });

  test("captures the elements of a re-rendered bar, not stale ones", () => {
    const titles = new VolumeTitles();
    titles.set(element("old"), 10);
    const replacement = element("new");
    titles.set(replacement, 20);
    titles.restore();
    expect(replacement.title).toBe("new");
  });
});
