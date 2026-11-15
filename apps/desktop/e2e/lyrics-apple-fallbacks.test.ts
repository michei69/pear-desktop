// The Apple Music style from the plugin's non-synced states: plain lyrics and
// provider errors share the same shell, picker and no source footer.

import { expect, test } from "./fixtures.ts";
import { lyrics, openLyricsTab, stubLyricsProviders } from "./helpers/lyrics.ts";
import { screenshot } from "./helpers/window.ts";

const PLAIN_LYRICS = [
  {
    id: 1,
    trackName: "Never Gonna Give You Up",
    artistName: "Rick Astley",
    duration: 213,
    instrumental: false,
    plainLyrics: "We're no strangers to love\nYou know the rules and so do I",
    syncedLyrics: null,
  },
];

test.use({
  appOptions: {
    plugins: {
      "synced-lyrics": {
        enabled: true,
        config: {
          lyricsStyle: "apple-music",
          usePriorityList: true,
          providerPriority: ["LRCLib"],
          preferredProvider: "LRCLib",
        },
      },
    },
  },
});

test("renders plain lyrics in the Apple shell", async ({ app, page }) => {
  test.setTimeout(120_000);
  await stubLyricsProviders(app, { body: PLAIN_LYRICS });

  await openLyricsTab(page);
  await expect(lyrics(page)).toHaveAttribute("data-state", "plain", { timeout: 30_000 });
  await expect(lyrics(page)).toHaveAttribute("data-style", "apple-music");
  await expect(lyrics(page).locator(".apple-music-plain .lines.plain .line")).toHaveCount(2);
  await expect(lyrics(page).locator(".apple-music-plain")).toContainText("We're no strangers to love");
  await expect(lyrics(page).locator("footer.source")).toHaveCount(0);
  const picker = lyrics(page).locator(".apple-music-picker .picker");
  await expect(picker).toBeVisible();
  await expect(picker).toHaveAttribute("data-selected", "LRCLib");
  await screenshot(app, "lyrics-apple-plain");
});

test("shows the loading fallback in the Apple shell", async ({ app, page }) => {
  test.setTimeout(120_000);
  await stubLyricsProviders(app, { body: PLAIN_LYRICS, delayMs: 5_000 });

  await openLyricsTab(page);
  await expect(lyrics(page)).toHaveAttribute("data-state", "loading");
  await expect(lyrics(page).locator(".apple-music-style .kaomoji[aria-busy='true']")).toBeVisible();
  await screenshot(app, "lyrics-apple-loading");
  await expect(lyrics(page)).toHaveAttribute("data-state", "plain", { timeout: 30_000 });
});

test("renders the retryable error in the Apple shell", async ({ app, page }) => {
  test.setTimeout(120_000);
  await stubLyricsProviders(app, { status: 400, body: "provider unavailable" });

  await openLyricsTab(page);
  await expect(lyrics(page)).toHaveAttribute("data-state", "error", { timeout: 30_000 });
  await expect(lyrics(page)).toHaveAttribute("data-style", "apple-music");
  // Other providers keep searching after the lead errors; pin the picker to
  // LRCLib so the fallback state is what this test asserts and screenshots.
  const picker = lyrics(page).locator(".apple-music-picker .picker");
  const providers = (await picker
    .locator(".picker-item")
    .evaluateAll((items) => items.map((item) => item.getAttribute("data-provider")!)))!;
  await picker.locator(".dot").nth(providers.indexOf("LRCLib")).click();
  await expect(lyrics(page)).toHaveAttribute("data-state", "error");
  await expect(lyrics(page).locator(".error .retry")).toBeVisible();
  await expect(lyrics(page).locator(".error .error-title")).toContainText("An error occurred");
  await expect(lyrics(page).locator("footer.source")).toHaveCount(0);
  await expect(picker).toBeVisible();
  await screenshot(app, "lyrics-apple-error");
});
