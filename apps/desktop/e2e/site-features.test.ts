// Site features: YTM's feature flags overridden as the page loads, the
// "Player bar" setting that picks the classic or the new player bar (YTM
// hands the new one to some visitors), and the plugins and the player facade
// working on either bar.

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { waitForTrackPlaying } from "./helpers/playback.ts";
import { barLayout, inBar, sel } from "./helpers/player-bar.ts";
import { setConfig } from "./helpers/plugins.ts";
import { openSection, openSettings, overlay, searchbox } from "./helpers/settings.ts";
import { mainWindow, playTestTrack } from "./launch.ts";

const PLAYING_TEST_MS = 240_000;
const VOLUME = 37;

const siteFlags = (page: Page) => page.evaluate(() => window.__pearRuntime!.siteFlags);
const liveFlag = (page: Page, name: string) => page.evaluate((name) => window.yt?.config_?.EXPERIMENT_FLAGS?.[name], name);
const playerState = (page: Page) => page.evaluate(() => window.__pearRuntime!.player.state);

declare global {
  interface Window {
    yt?: { config_?: { EXPERIMENT_FLAGS?: Record<string, unknown> } };
  }
}

for (const layout of ["classic", "new"] as const) {
  test(`the ${layout} player bar: picked by the setting, with the plugins' buttons and the player's controls`, async ({ launch }) => {
    test.setTimeout(PLAYING_TEST_MS);
    const app = await launch({
      core: { site: { playerBar: layout } },
      plugins: { "playback-speed": { enabled: true }, downloader: { enabled: true }, "do-not-track": { enabled: true } },
    });
    const page = await mainWindow(app);
    await playTestTrack(page);
    await waitForTrackPlaying(page);

    expect(await barLayout(page)).toBe(layout);
    expect((await siteFlags(page)).overrides).toMatchObject({ music_web_enable_wiz_miniplayer: layout === "new" });
    expect(await liveFlag(page, "music_web_enable_wiz_miniplayer")).toBe(layout === "new");

    // Plugins find their place on either bar.
    await expect(page.locator(inBar(".pear-speed-button"))).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(inBar(".pear-dl-button"))).toBeVisible();

    // The facade sets the volume through the bar's slider and reads it back.
    await page.evaluate((value) => window.__pearRuntime!.player.control({ type: "volume", value }), VOLUME);
    await expect
      .poll(() =>
        page.evaluate(
          (slider) => Number(document.querySelector<HTMLElement & { value: number | string }>(slider)!.value),
          sel("player_bar.volume_slider"),
        ),
      )
      .toBe(VOLUME);
    await expect.poll(async () => (await playerState(page)).volume).toBe(VOLUME);

    // Shuffle goes through the bar's button and comes back as state.
    const shuffled = (await playerState(page)).shuffle;
    await page.evaluate(() => window.__pearRuntime!.player.control({ type: "shuffle" }));
    await expect.poll(async () => (await playerState(page)).shuffle).toBe(!shuffled);
  });
}

test("the player-bar download button can be hidden without disabling downloads", async ({ launch }) => {
  test.setTimeout(PLAYING_TEST_MS);
  const app = await launch({
    plugins: { downloader: { enabled: true, config: { showPlayerButton: false } } },
  });
  const page = await mainWindow(app);
  await playTestTrack(page);
  await waitForTrackPlaying(page);

  await expect(page.locator(inBar(".pear-dl-button"))).toHaveCount(0);
  // The option only hides the button; the app menu still opens Downloads.
  const downloadsLabel = await app.evaluate(({ Menu }) => {
    const options = Menu.getApplicationMenu()?.items.find((item) => item.label === "Options");
    return options?.submenu?.items.some((item) => item.label === "Downloads");
  });
  expect(downloadsLabel).toBe(true);
  // The setting applies live: the page part restarts and mounts the button.
  await setConfig(page, "downloader", { showPlayerButton: true });
  await expect(page.locator(inBar(".pear-dl-button"))).toBeVisible({ timeout: 15_000 });
});

test("feature flag overrides reach the page, and the flag list edits them", async ({ launch }) => {
  const app = await launch({ core: { site: { siteFlags: ["pear_e2e_flag=42", "pear_e2e_switch=false"] } } });
  const page = await mainWindow(app);
  await page.waitForFunction(() => Object.keys(window.__pearRuntime!.siteFlags.served).length > 0);

  expect(await liveFlag(page, "pear_e2e_flag")).toBe(42);
  expect(await liveFlag(page, "pear_e2e_switch")).toBe(false);
  // What YTM served is kept apart: it never sent these.
  expect((await siteFlags(page)).served).not.toHaveProperty("pear_e2e_flag");

  await openSettings(page);
  await openSection(page, "Flags");
  // The Flags section lists the page's served flags plus the overrides; the search box
  // filters them in place (no separate card).
  await searchbox(page).fill("pear_e2e");
  const rows = overlay(page).locator(".flag-row");
  await expect(rows).toHaveCount(2);

  // Switching one on edits the override; Undo puts the page's own value back.
  const entries = () => page.evaluate(() => window.__pearRuntime!.plugins.core("site").config.siteFlags);
  await overlay(page).locator('[data-flag="pear_e2e_switch"]').getByRole("switch").click();
  await expect.poll(entries).toEqual(["pear_e2e_flag=42", "pear_e2e_switch=true"]);
  await overlay(page).locator('[data-flag="pear_e2e_flag"]').getByRole("button", { name: "Undo" }).click();
  await expect.poll(entries).toEqual(["pear_e2e_switch=true"]);
});
