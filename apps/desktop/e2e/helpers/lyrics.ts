import type { ElectronApplication, Page } from "@playwright/test";
import { playTestTrack } from "../launch.ts";
import { waitForTrackPlaying } from "./playback.ts";

export const lyrics = (page: Page) => page.locator("pear-synced-lyrics");

/** Plays the test track and opens the player page's Lyrics tab. */
export async function openLyricsTab(page: Page) {
  await playTestTrack(page);
  await waitForTrackPlaying(page);
  await page.locator("ytmusic-player-page tp-yt-paper-tab").nth(1).click();
}

export function stubLyricsProviders(
  app: ElectronApplication,
  { status = 200, body, delayMs }: { status?: number; body?: unknown; delayMs?: number } = {},
) {
  return app.evaluate(
    async ({ session, net }, { status, body, delayMs }) => {
      const otherProviders = new Set([
        "lrc.red",
        "lrchub.coreone.work",
        "api.megalobiz.com",
        "interface.music.163.com",
        "api-lyrics.simpmusic.org",
        "ytmbrowseproxy.zvz.be",
        "lyrics.kugou.com",
        "lyrics-api.boidu.dev",
        "beta.music.apple.com",
        "amp-api.music.apple.com",
        "lyrics.paxsenix.org",
      ]);
      session.defaultSession.protocol.handle("https", async (request) => {
        const host = new URL(request.url).hostname;
        if (host === "lrclib.net") {
          if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
          return typeof body === "string" ? new Response(body, { status }) : Response.json(body, { status });
        }
        if (otherProviders.has(host)) return new Response("no lyrics", { status: 404 });
        return net.fetch(request, { bypassCustomProtocolHandlers: true });
      });
    },
    { status, body, delayMs },
  );
}
