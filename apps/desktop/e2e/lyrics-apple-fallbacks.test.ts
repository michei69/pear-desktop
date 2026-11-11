// The Apple Music style from the plugin's non-synced states: plain lyrics and
// provider errors share the same shell, picker and no source footer.

import { expect, test } from "./fixtures.ts";
import { waitForTrackPlaying } from "./helpers/playback.ts";
import { screenshot } from "./helpers/window.ts";
import { type mainWindow, playTestTrack } from "./launch.ts";

const lyrics = (page: Awaited<ReturnType<typeof mainWindow>>) => page.locator("pear-synced-lyrics");

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

async function openLyrics(page: Awaited<ReturnType<typeof mainWindow>>) {
  await playTestTrack(page);
  await waitForTrackPlaying(page);
  await page.locator("ytmusic-player-page tp-yt-paper-tab").nth(1).click();
}

test("renders plain lyrics in the Apple shell", async ({ app, page }) => {
  test.setTimeout(120_000);
  await app.evaluate(({ session, net }) => {
    const otherProviders = new Set([
      "lrc.red",
      "lrchub.coreone.work",
      "api.megalobiz.com",
      "apic-appmobile.musixmatch.com",
      "interface.music.163.com",
      "api-lyrics.simpmusic.org",
      "ytmbrowseproxy.zvz.be",
    ]);
    session.defaultSession.protocol.handle("https", (request) => {
      const host = new URL(request.url).hostname;
      if (host === "lrclib.net") {
        return Response.json([
          {
            id: 1,
            trackName: "Never Gonna Give You Up",
            artistName: "Rick Astley",
            duration: 213,
            instrumental: false,
            plainLyrics: "We're no strangers to love\nYou know the rules and so do I",
            syncedLyrics: null,
          },
        ]);
      }
      if (otherProviders.has(host)) return new Response("no lyrics", { status: 404 });
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    });
  });

  await openLyrics(page);
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

test("renders the retryable error in the Apple shell", async ({ app, page }) => {
  test.setTimeout(120_000);
  await app.evaluate(({ session, net }) => {
    const otherProviders = new Set([
      "lrc.red",
      "lrchub.coreone.work",
      "api.megalobiz.com",
      "apic-appmobile.musixmatch.com",
      "interface.music.163.com",
      "api-lyrics.simpmusic.org",
      "ytmbrowseproxy.zvz.be",
    ]);
    session.defaultSession.protocol.handle("https", (request) => {
      const host = new URL(request.url).hostname;
      if (host === "lrclib.net") return new Response("provider unavailable", { status: 400 });
      if (otherProviders.has(host)) return new Response("no lyrics", { status: 404 });
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    });
  });

  await openLyrics(page);
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
