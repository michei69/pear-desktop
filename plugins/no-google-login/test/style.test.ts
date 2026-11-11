import { describe, expect, test } from "vitest";
import plugin from "../index.ts";

const style = () => plugin.style as string;

describe("Hide sign-in prompts", () => {
  test("hides every sign-in link, not just the nav bar's", () => {
    // A bare rule like pear-desktop's, not the narrowed .sign-in-link.ytmusic-nav-bar.
    expect(style()).toMatch(/(^|[,}])\.sign-in-link[,{]/);
    expect(style()).not.toContain(".sign-in-link.ytmusic-nav-bar");
  });

  test("keeps the guide promo, premium link and liked tab hidden", () => {
    expect(style()).toContain("ytmusic-guide-signin-promo-renderer");
    expect(style()).toContain("/music_premium");
    expect(style()).toMatch(/ytmusic-pivot-bar-renderer\[tab-id=["']?FEmusic_liked["']?\]/);
  });
});
