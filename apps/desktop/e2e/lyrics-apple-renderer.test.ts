// The clean-room Apple Music renderer against a controlled lrc.red TTML payload:
// gaps, word timing, duet sides, background vocals, RTL, translations, scrolling.

import { expect, test } from "./fixtures.ts";
import { waitForTrackPlaying } from "./helpers/playback.ts";
import { screenshot } from "./helpers/window.ts";
import { type mainWindow, playTestTrack } from "./launch.ts";

const pad = (value: number, size = 2) => String(value).padStart(size, "0");
const seconds = (value: number) => {
  const total = Math.max(0, Math.round(value * 1000));
  return `${pad(Math.floor(total / 3_600_000))}:${pad(Math.floor(total / 60_000) % 60)}:${pad(Math.floor(total / 1000) % 60)}.${pad(total % 1000, 3)}`;
};

function ttmlLine(start: number, end: number, text: string, attributes: string[] = [], body?: string) {
  return `    <p begin="${seconds(start)}" end="${seconds(end)}" ${attributes.join(" ")}>${body ?? text}</p>`;
}

const LINE = (start: number, end: number, text: string, words: string[], attributes: string[] = []) =>
  ttmlLine(
    start,
    end,
    text,
    attributes,
    words
      .map((word, index) => {
        const begin = start + (index * (end - start)) / words.length;
        const finish = start + ((index + 1) * (end - start)) / words.length;
        return `<span begin="${seconds(begin)}" end="${seconds(finish)}">${word} </span>`;
      })
      .join(""),
  );

function buildTTML() {
  const many = Array.from({ length: 40 }, (_, index) => {
    const start = 36 + index * 3;
    return LINE(start, start + 2.6, `Later line ${index + 1}`, [`Later `, `line `, `${index + 1}`]);
  });

  const translated = ["第1行", "第2行", "第3行", "第4行", ...many.map((_, index) => `第${index + 5}行`)]
    .map((text, index) => `<text for="L${index + 1}">${text}</text>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyrics" xml:lang="en">
  <head><metadata>
    <ttm:agent xml:id="v1" type="person"/>
    <ttm:agent xml:id="v2" type="other"/>
    <translation xml:lang="zh-CN">${translated}</translation>
  </metadata></head>
  <body><div>
${LINE(8, 12, "Hello from the other side", ["Hello ", "from ", "the ", "other ", "side"], ['itunes:key="L1"', 'ttm:agent="v1"'])}
${ttmlLine(
  12,
  16,
  "Right side duet line",
  ['itunes:key="L2"', 'ttm:agent="v2"'],
  `<span ttm:role="x-bg"><span begin="${seconds(12)}" end="${seconds(14)}">background vocals</span></span><span begin="${seconds(13)}" end="${seconds(16)}">Right side duet line</span>`,
)}
${LINE(16, 20, "שלום עולם", ["שלום ", "עולם"], ['itunes:key="L3"', 'ttm:agent="v1"', 'dir="rtl"'])}
${LINE(28, 32, "After a long instrumental gap", ["After ", "a long ", "instrumental ", "gap"], ['itunes:key="L4"', 'ttm:agent="v1"'])}
${many.join("\n")}
  </div></body>
</tt>`;
}

test.use({
  appOptions: {
    plugins: {
      "synced-lyrics": {
        enabled: true,
        config: {
          lyricsStyle: "apple-music",
          usePriorityList: true,
          providerPriority: ["LrcRed"],
          preferredProvider: "LrcRed",
          romanization: false,
          translationEnabled: true,
          translationTargetLanguage: "zh-CN",
        },
      },
    },
  },
});

const lyrics = (page: Awaited<ReturnType<typeof mainWindow>>) => page.locator("pear-synced-lyrics");

async function seek(page: Awaited<ReturnType<typeof mainWindow>>, at: number) {
  await page.evaluate((seconds) => {
    window.__pearRuntime!.player.control({ type: "seek", seconds });
    window.__pearRuntime!.player.control({ type: "pause" });
  }, at);
  await expect
    .poll(async () => page.evaluate(() => Math.round(document.querySelector("video")!.currentTime)))
    .toBeGreaterThanOrEqual(Math.floor(at) - 1);
}

async function active(page: Awaited<ReturnType<typeof mainWindow>>) {
  return page.evaluate(() => {
    const root = document.querySelector("pear-synced-lyrics")?.shadowRoot?.querySelector(".apple-music-style");
    const line = root?.querySelector<HTMLElement>(".apple-line.active");
    return {
      text: line?.querySelector(".apple-main")?.textContent?.trim() ?? "",
      classes: line?.className ?? "",
      start: Number(line?.dataset.startTime ?? -1),
    };
  });
}

test("the clean-room Apple renderer matches the Apple Music style's behaviour", async ({ app, page }) => {
  test.setTimeout(240_000);
  await app.evaluate(({ session, net }, ttml) => {
    session.defaultSession.protocol.handle("https", (request) => {
      const url = new URL(request.url);
      if (url.hostname !== "lrc.red") return net.fetch(request, { bypassCustomProtocolHandlers: true });
      if (url.pathname === "/match.json") {
        return Response.json({ hits: [{ isrc: "TESTTESTTEST", title: "Never Gonna Give You Up", artist: "Rick Astley", duration: 213 }] });
      }
      if (url.pathname === "/s/TESTTESTTEST.song.json") {
        return Response.json({
          title: "Never Gonna Give You Up",
          artist: "Rick Astley",
          duration: 213,
          source: ttml,
          lyrics: { lines: [] },
        });
      }
      return new Response("not found", { status: 404 });
    });
  }, buildTTML());

  await playTestTrack(page);
  await waitForTrackPlaying(page);
  await page.locator("ytmusic-player-page tp-yt-paper-tab").nth(1).click();
  await expect(lyrics(page)).toHaveAttribute("data-state", "synced", { timeout: 30_000 });
  await expect(lyrics(page)).toHaveAttribute("data-style", "apple-music");
  await expect(lyrics(page).locator("footer.source")).toHaveCount(0);

  // Intro gap: dots own the row, the first line is dimmed.
  await seek(page, 2);
  await expect(lyrics(page).locator(".apple-gap.active")).toHaveCount(1);
  await expect(lyrics(page).locator(".apple-gap.active .apple-gap-dot")).toHaveCount(3);
  expect((await active(page)).start).not.toBe(8000);
  await screenshot(app, "apple-clean-gap");

  // Word timing at a paused 9.5s: 1, 0.5 and 0 for the three word groups.
  await seek(page, 9.2);
  await expect.poll(async () => (await active(page)).start).toBe(8000);
  const timed = await page.evaluate(() => {
    const root = document.querySelector("pear-synced-lyrics")?.shadowRoot?.querySelector(".apple-music-style");
    return [...(root?.querySelectorAll<HTMLElement>(".apple-line.active .apple-main .apple-word") ?? [])].map((word) =>
      Number(word.style.getPropertyValue("--p")),
    );
  });
  expect(timed[0]).toBeGreaterThan(0.95);
  expect(timed[1]).toBeGreaterThan(0.3);
  expect(timed[1]).toBeLessThan(0.75);
  expect(timed[2]).toBeLessThan(0.1);
  await screenshot(app, "apple-clean-words");

  // Duet side and background vocals.
  await seek(page, 13.5);
  await expect.poll(async () => (await active(page)).start).toBe(12000);
  const duet = await active(page);
  expect(duet.classes).toContain("singer-right");
  const background = await page.evaluate(() => {
    const root = document.querySelector("pear-synced-lyrics")?.shadowRoot?.querySelector(".apple-music-style");
    const bg = root?.querySelector<HTMLElement>(".apple-line.active .apple-bg");
    return { text: bg?.textContent?.trim() ?? "", visible: bg ? getComputedStyle(bg).visibility !== "hidden" : false };
  });
  expect(background.text).toContain("background vocals");
  expect(background.visible).toBe(true);
  expect(
    await page.evaluate(() => {
      const root = document.querySelector("pear-synced-lyrics")?.shadowRoot?.querySelector(".apple-music-style");
      return root?.querySelector<HTMLElement>(".apple-line.active .apple-bg")?.classList.contains("expanded") ?? false;
    }),
  ).toBe(true);
  await screenshot(app, "apple-clean-duet");

  // RTL is right-aligned.
  await seek(page, 17.5);
  await expect.poll(async () => (await active(page)).start).toBe(16000);
  expect((await active(page)).classes).toContain("rtl");
  expect(
    await page.evaluate(() => {
      const root = document.querySelector("pear-synced-lyrics")?.shadowRoot?.querySelector(".apple-music-style");
      const line = root?.querySelector<HTMLElement>(".apple-line.active");
      return line ? getComputedStyle(line).textAlign : "";
    }),
  ).toBe("right");
  await screenshot(app, "apple-clean-rtl");
  expect(
    await page.evaluate(() => {
      const root = document.querySelector("pear-synced-lyrics")?.shadowRoot?.querySelector(".apple-music-style");
      return [...(root?.querySelectorAll<HTMLElement>(".apple-line") ?? [])]
        .filter((line) => line.textContent?.includes("background vocals"))
        .every((line) => !line.querySelector(".apple-bg")?.classList.contains("expanded"));
    }),
  ).toBe(true);

  // The long break has its own row and the line after it carries the translation.
  await seek(page, 24);
  await expect(lyrics(page).locator(".apple-gap.active")).toHaveCount(1);
  await screenshot(app, "apple-clean-gap2");
  await seek(page, 30);
  await expect.poll(async () => (await active(page)).start).toBe(28000);
  await expect(lyrics(page).locator(".apple-line.active .apple-translation")).toHaveText("第4行");

  // A long list scrolls the active line into view and centers it.
  await seek(page, 60);
  await expect.poll(async () => (await active(page)).start).toBeGreaterThanOrEqual(36000);
  const scrolled = await page.evaluate(() => {
    const host = document.querySelector("pear-synced-lyrics")?.shadowRoot;
    const scroll = host?.querySelector<HTMLElement>(".apple-music-scroll");
    const active = host?.querySelector<HTMLElement>(".apple-line.active");
    if (!scroll || !active) return null;
    const box = scroll.getBoundingClientRect();
    const rect = active.getBoundingClientRect();
    return { scrollTop: scroll.scrollTop, top: rect.top, bottom: rect.bottom, boxTop: box.top, boxBottom: box.bottom };
  });
  expect(scrolled).not.toBeNull();
  expect(scrolled!.scrollTop).toBeGreaterThan(100);
  expect(scrolled!.top).toBeGreaterThanOrEqual(scrolled!.boxTop - 1);
  expect(scrolled!.bottom).toBeLessThanOrEqual(scrolled!.boxBottom + 1);
  await screenshot(app, "apple-clean-scroll");

  // Clicking a later line seeks to it.
  const target = lyrics(page).locator(".apple-line").filter({ hasText: "Later line 30" }).first();
  await target.click();
  await expect.poll(async () => page.evaluate(() => document.querySelector("video")!.currentTime)).toBeGreaterThan(110);
});
