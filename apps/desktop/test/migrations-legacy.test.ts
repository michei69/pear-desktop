// Old pear-desktop configs (before 3.12) still go through the whole migration
// chain: plugin list, shortcut arrays, renamed plugins and priority lists.

import { describe, expect, test } from "vitest";
import { migrate } from "../src/main/migrations/index.ts";

const legacy = (version: string, plugins: unknown, options: Record<string, unknown> = {}) =>
  ({ __internal__: { migrations: { version } }, plugins, options }) as never;

describe("pre-3.12 migrations", () => {
  test("an enabled-plugin array becomes entries, with pear-desktop's defaults", () => {
    const { config } = migrate(legacy("1.6.0", ["shortcuts", "hide-video-player"]), "4.0.0");
    expect(config.plugins).toMatchObject({
      "do-not-track": { enabled: true },
      downloader: { enabled: false },
      shortcuts: { enabled: true },
      "video-toggle": { enabled: true, mode: "custom" },
    });
    expect(config.plugins).not.toHaveProperty("hide-video-player");
    expect(config.plugins).not.toHaveProperty("picture-in-picture");
    expect(config.plugins).not.toHaveProperty("visualizer");
  });

  test("shortcut arrays become records per scope", () => {
    const { config } = migrate(
      legacy("1.11.0", {
        shortcuts: {
          global: [
            { action: "playPause", shortcut: "Ctrl+F1" },
            { action: "next", shortcut: "Ctrl+F2" },
          ],
          local: [],
        },
      }),
      "4.0.0",
    );
    expect(config.plugins?.shortcuts).toMatchObject({ global: { playPause: "Ctrl+F1", next: "Ctrl+F2" }, local: {} });
  });

  test("the Last.fm plugin and lyrics-genius fold into their successors", () => {
    const { config } = migrate(
      legacy("3.2.0", {
        lastfm: { enabled: true, token: "t", session_key: "s", api_root: "r", api_key: "k", secret: "x" },
        "lyrics-genius": { enabled: true },
      }),
      "4.0.0",
    );
    expect(config.plugins?.lastfm).toBeUndefined();
    expect(config.plugins?.["lyrics-genius"]).toBeUndefined();
    expect(config.plugins?.scrobbler).toMatchObject({
      scrobblers: { lastfm: { enabled: true, token: "t", sessionKey: "s", apiRoot: "r", apiKey: "k", secret: "x" } },
    });
    expect(config.plugins?.["synced-lyrics"]).toMatchObject({ enabled: true });
  });

  test("the single preferred provider becomes a priority list", () => {
    const { config } = migrate(legacy("3.12.2", { "synced-lyrics": { enabled: true, preferredProvider: "lrclib" } }), "4.0.0");
    expect(config.plugins?.["synced-lyrics"]).toMatchObject({ providerPriority: ["lrclib"], usePriorityList: true });
    expect(config.plugins?.["synced-lyrics"]).not.toHaveProperty("preferredProvider");
  });

  test("3.12.4 removes the dropped option and plugins", () => {
    const { config } = migrate(
      legacy("3.12.3", { "skip-disliked-songs": { enabled: true }, "compact-sidebar": { enabled: true } }, { inProcessGpu: true }),
      "4.0.0",
    );
    expect(config.options).not.toHaveProperty("inProcessGpu");
    expect(config.plugins).not.toHaveProperty("skip-disliked-songs");
    expect(config.plugins).not.toHaveProperty("compact-sidebar");
  });
});
