// synced-lyrics against real YTM (logged out) and real providers.

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { pause, waitForTrackPlaying } from "./helpers/playback.ts";
import { setConfig, setEnabled } from "./helpers/plugins.ts";
import { screenshot } from "./helpers/window.ts";
import { mainWindow, playTestTrack } from "./launch.ts";

test.use({ appOptions: { plugins: { "synced-lyrics": { enabled: true } } } });

/** Plays the test track and opens the player page's Lyrics tab. */
async function openLyricsTab(page: Page) {
  await playTestTrack(page);
  await waitForTrackPlaying(page);
  await page.locator("ytmusic-player-page tp-yt-paper-tab").nth(1).click();
}

/**
 * An LRCLIB entry for the test track with word timing (LRCLIB rarely has it):
 * the same five words, every few seconds.
 */
function wordSyncedEntry() {
  const words = ["Never ", "gonna ", "give ", "you ", "up"];
  const LINES = 60;
  const FIRST_MS = 3000;
  const LINE_MS = 3000;
  const LINE_LENGTH_MS = 2500;
  const WORD_MS = 500;
  const lines = Array.from({ length: LINES }, (_, i) => {
    const start = FIRST_MS + i * LINE_MS;
    return [
      `- text: ${words.join("")}`,
      `  start_ms: ${start}`,
      `  end_ms: ${start + LINE_LENGTH_MS}`,
      "  words:",
      ...words.flatMap((word, w) => [
        `  - text: ${word.trim()}`,
        `    start_ms: ${start + w * WORD_MS}`,
        `    end_ms: ${start + (w + 1) * WORD_MS}`,
      ]),
    ].join("\n");
  });
  return {
    id: 1,
    trackName: "Never Gonna Give You Up",
    artistName: "Rick Astley",
    duration: 213,
    instrumental: false,
    hasWordSync: true,
    plainLyrics: "Never gonna give you up",
    syncedLyrics: "[00:03.00]Never gonna give you up",
    lyricsfile: `version: '1.0'\nlines:\n${lines.join("\n")}\n`,
  };
}

const lyrics = (page: Page) => page.locator("pear-synced-lyrics");
const activeIndex = (page: Page) =>
  page.evaluate(() => {
    const lines = [...(document.querySelector("pear-synced-lyrics")?.shadowRoot?.querySelectorAll(".lines .line") ?? [])];
    return lines.findIndex((line) => line.getAttribute("data-state") === "active");
  });

test("shows synced lyrics in the Lyrics tab, follows playback and seeks on click", async ({ app, page }) => {
  test.setTimeout(180_000);
  await openLyricsTab(page);
  await expect(lyrics(page)).toHaveAttribute("open", "");
  await expect(lyrics(page)).toHaveAttribute("data-state", "synced", { timeout: 30_000 });
  const lines = lyrics(page).locator(".lines .line");
  expect(await lines.count()).toBeGreaterThan(20);
  await expect(lines.filter({ hasText: "We're no strangers to love" }).first()).toBeVisible();
  // YTM's own (unsynced) lyrics are hidden behind ours.
  await expect(page.locator("ytmusic-player-page #tab-renderer > ytmusic-section-list-renderer")).toBeHidden();

  // Seek into the first chorus; the active line must follow playback from there.
  await page.evaluate(() => window.__pearRuntime!.player.control({ type: "seek", seconds: 43 }));
  await expect.poll(() => activeIndex(page)).toBeGreaterThan(0);
  const first = await activeIndex(page);
  await expect.poll(() => activeIndex(page), { timeout: 15_000 }).toBeGreaterThan(first);
  const active = lyrics(page).locator('.line[data-state="active"]');
  await expect(active).toBeInViewport();
  await screenshot(app, "lyrics-synced");

  // Clicking a line seeks to it.
  await lines.filter({ hasText: "We're no strangers to love" }).first().click();
  await expect.poll(() => page.evaluate(() => document.querySelector("video")!.currentTime)).toBeLessThan(25);
  await expect(active).toContainText("strangers");

  // The provider picker (pear-desktop's): the provider shown, with what it found.
  const picker = lyrics(page).locator(".picker");
  await expect(picker).toHaveAttribute("data-selected", /LrcRed|LRCLib|YTMusic/);
  const selected = (await picker.getAttribute("data-selected"))!;
  await expect(picker.locator(`.picker-item[data-provider="${selected}"]`)).toHaveAttribute("data-status", "found");
  await expect(picker.locator(`.picker-item[data-provider="${selected}"] .name`)).toBeInViewport();
  // Its arrows move through the providers and back again.
  const providers = (await picker
    .locator(".picker-item")
    .evaluateAll((items) => items.map((item) => item.getAttribute("data-provider")!)))!;
  const nextProvider = providers[(providers.indexOf(selected) + 1) % providers.length]!;
  await picker.locator(".arrow.next").click();
  await expect(picker).toHaveAttribute("data-selected", nextProvider);
  await picker.locator(".arrow.previous").click();
  await expect(picker).toHaveAttribute("data-selected", selected);
  await expect(lyrics(page)).toHaveAttribute("data-state", "synced");
  await screenshot(app, "lyrics-picker");
  // A dot jumps straight to its provider.
  await picker.locator(".dot").nth(providers.indexOf("MusixMatch")).click();
  await expect(picker).toHaveAttribute("data-selected", "MusixMatch");
  await picker.locator(".dot").nth(providers.indexOf(selected)).click();
  await expect(lyrics(page)).toHaveAttribute("data-state", "synced");

  // It slides away while the lyrics are scrolled, unless the pointer is near it.
  await page.mouse.move(5, 5);
  await page.evaluate(() => document.querySelector("pear-synced-lyrics")!.parentElement!.scrollBy(0, 400));
  await expect(picker).toHaveAttribute("data-hidden", "true");

  // Disabling restores YTM's own lyrics live.
  await setEnabled(page, "synced-lyrics", false);
  await expect(lyrics(page)).toHaveCount(0);
});

test("switches to the Apple Music style", async ({ app, page }) => {
  test.setTimeout(180_000);
  await openLyricsTab(page);
  await expect(lyrics(page)).toHaveAttribute("data-state", "synced", { timeout: 30_000 });

  await setConfig(page, "synced-lyrics", { lyricsStyle: "apple-music" });
  await expect(lyrics(page)).toHaveAttribute("data-style", "apple-music");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const apple = document.querySelector("pear-synced-lyrics")?.shadowRoot?.querySelector("am-lyrics") as
          | (HTMLElement & { ttml?: string })
          | null;
        return Boolean(apple?.ttml?.includes("<tt"));
      }),
    )
    .toBe(true);
  // Master's Apple style keeps its picker visible over the lyrics; it is only
  // hidden by scrolling down, never behind am-lyrics' readiness.
  const applePicker = lyrics(page).locator(".apple-music-picker .picker");
  await expect(applePicker).toBeVisible();
  await expect(applePicker).not.toHaveAttribute("data-hidden", "true");
  // The plugin's source footer belongs to neither renderer (master never had it),
  // and am-lyrics' own "Source" footer must stay hidden behind the component.
  // Seeking drives the component too: the current line is the active one.
  await page.evaluate(() => window.__pearRuntime!.player.control({ type: "seek", seconds: 43 }));
  await expect
    .poll(() =>
      page.evaluate(() => {
        const lyricsHost = document.querySelector("pear-synced-lyrics")?.shadowRoot;
        const apple = lyricsHost?.querySelector("am-lyrics");
        return Boolean(apple?.shadowRoot?.querySelector(".lyrics-line.active")?.textContent?.trim());
      }),
    )
    .toBe(true);
  await expect(lyrics(page).locator("footer.source")).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const lyricsHost = document.querySelector("pear-synced-lyrics")?.shadowRoot;
      const apple = lyricsHost?.querySelector("am-lyrics");
      const content = apple?.shadowRoot?.querySelector<HTMLElement>(".lyrics-footer .footer-content");
      return !content || getComputedStyle(content).display === "none";
    }),
  ).toBe(true);
  // Scrolled down it slips away, and comes back when the pointer reaches the top.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const lyricsHost = document.querySelector("pear-synced-lyrics")?.shadowRoot;
        return lyricsHost?.querySelector<HTMLElement>(".apple-music-picker")?.style.getPropertyValue("--apple-music-picker-offset");
      }),
    )
    .not.toBe("0px");
  const lyricsBox = (await lyrics(page).boundingBox())!;
  await page.mouse.move(lyricsBox.x + lyricsBox.width / 2, lyricsBox.y + 8);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const lyricsHost = document.querySelector("pear-synced-lyrics")?.shadowRoot;
        return lyricsHost?.querySelector<HTMLElement>(".apple-music-picker")?.style.getPropertyValue("--apple-music-picker-offset");
      }),
    )
    .toBe("0px");
  // Its arrows switch providers without losing the component or the picker.
  const appleProviders = (await applePicker
    .locator(".picker-item")
    .evaluateAll((items) => items.map((item) => item.getAttribute("data-provider")!)))!;
  const appleSelected = (await applePicker.getAttribute("data-selected"))!;
  const appleNext = appleProviders[(appleProviders.indexOf(appleSelected) + 1) % appleProviders.length]!;
  await applePicker.locator(".arrow.next").click();
  await expect(applePicker).toHaveAttribute("data-selected", appleNext);
  await applePicker.locator(".dot").nth(appleProviders.indexOf(appleSelected)).click();
  await expect(applePicker).toHaveAttribute("data-selected", appleSelected);
  await screenshot(app, "lyrics-apple-music");

  await setConfig(page, "synced-lyrics", { lyricsStyle: "standard" });
  await expect(lyrics(page)).toHaveAttribute("data-style", "standard");
});

test("highlights word by word when the provider has word timing", async ({ app, page }) => {
  test.setTimeout(180_000);
  await playTestTrack(page);
  await waitForTrackPlaying(page);

  // Serve the word-synced entry only while searching: proxying all of https would disturb playback.
  await app.evaluate(({ session, net }, entry) => {
    session.defaultSession.protocol.handle("https", (request) =>
      new URL(request.url).hostname === "lrclib.net" ? Response.json([entry]) : net.fetch(request, { bypassCustomProtocolHandlers: true }),
    );
  }, wordSyncedEntry());
  // A search setting change searches again (and misses the cache).
  // The stub only serves LRCLib, and lrc.red now precedes it in the default order.
  await setConfig(page, "synced-lyrics", { preferredProvider: "LRCLib", showLyricsEvenIfInexact: false });
  await page.locator("ytmusic-player-page tp-yt-paper-tab").nth(1).click();
  await expect(lyrics(page).locator(".picker")).toHaveAttribute("data-selected", "LRCLib", { timeout: 30_000 });
  await expect(lyrics(page).locator('.picker-item[data-provider="LRCLib"]')).toHaveAttribute("title", /Word-synced/);
  await app.evaluate(({ session }) => session.defaultSession.protocol.unhandle("https"));

  // Mid-line: earlier words are filled, later ones not yet.
  await page.evaluate(() => window.__pearRuntime!.player.control({ type: "seek", seconds: 31.2 }));
  const fills = () =>
    page.evaluate(() =>
      [...(document.querySelector("pear-synced-lyrics")?.shadowRoot?.querySelectorAll('.line[data-state="active"] .word') ?? [])].map(
        (word) => Number((word as HTMLElement).style.getPropertyValue("--p")),
      ),
    );
  await expect.poll(async () => (await fills()).length).toBe(5);
  await pause(page);
  await page.evaluate(() => window.__pearRuntime!.player.control({ type: "seek", seconds: 31.3 }));
  await expect
    .poll(async () => {
      const [first, , third, , last] = await fills();
      return first === 1 && third! > 0 && third! < 1 && last === 0;
    })
    .toBe(true);
  await screenshot(app, "lyrics-words");
});

test("Megalobiz lyrics as pear-desktop's preferred provider; Musixmatch says it needs a token", async ({ launch }) => {
  test.setTimeout(180_000);
  // pear-desktop's provider name, as its config.json stores it.
  const page = await mainWindow(
    await launch({ plugins: { "synced-lyrics": { enabled: true, config: { preferredProvider: "Megalobiz" } } } }),
  );
  await openLyricsTab(page);

  const megalobiz = lyrics(page).locator('.picker-item[data-provider="Megalobiz"]');
  await expect(megalobiz).toHaveAttribute("data-status", "found", { timeout: 30_000 });
  await expect(lyrics(page).locator(".picker")).toHaveAttribute("data-selected", "Megalobiz");
  await expect(lyrics(page)).toHaveAttribute("data-state", "synced");
  await expect(
    lyrics(page)
      .locator(".lines .line")
      .filter({ hasText: /strangers to love/i })
      .first(),
  ).toBeAttached();
  // Megalobiz's terms ask to link to the sheet.
  await expect(lyrics(page).locator(".source a")).toHaveAttribute("href", /^https:\/\/megalobiz\.com\/lrc\/\d+/);

  // Anonymous Musixmatch only has decoy lyrics: it reports why instead of showing them.
  const musixmatch = lyrics(page).locator('.picker-item[data-provider="MusixMatch"]');
  await expect(musixmatch).toHaveAttribute("data-status", "error", { timeout: 30_000 });
  await expect(musixmatch).toHaveAttribute("title", /user token/);
  // Selected, it shows the error with a retry button, as pear-desktop does.
  await lyrics(page).locator('.dot[aria-label="MusixMatch"]').click();
  await expect(lyrics(page)).toHaveAttribute("data-state", "error");
  await expect(lyrics(page).locator(".error-detail")).toContainText("user token");
  // The provider's message, not Electron's IPC wrapper around it.
  await expect(lyrics(page).locator(".error-detail")).not.toContainText("invoking remote method");
  await expect(lyrics(page).locator(".retry")).toBeVisible();
});
