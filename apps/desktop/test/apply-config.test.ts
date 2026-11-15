// Applying an API config patch to the running app: core sections, plugins and
// the API server itself, so a patch over HTTP or MCP is not inert until restart.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, definePlugin } from "@pear/sdk";
import { afterAll, describe, expect, test, vi } from "vitest";
import { applyConfigPatch, type ConfigApplyEnvironment } from "../src/main/apply-config.ts";
import { Settings } from "../src/main/config.ts";
import type { PluginHost } from "../src/main/plugins.ts";

vi.mock("electron", () => ({}));

const lyrics = definePlugin({
  id: "synced-lyrics",
  name: "Synced lyrics",
  config: {
    preciseTiming: config.bool(true, { label: "Precise timing" }),
    romanization: config.bool(true, { label: "Romanize" }),
  },
});
const tray = definePlugin({ id: "tray", name: "Tray icon", enabledByDefault: true });
const PLUGINS = [lyrics, tray];

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A profile with an empty (or given) config.json. */
function profile(stored?: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "pear-apply-config-"));
  dirs.push(dir);
  if (stored !== undefined) writeFileSync(join(dir, "config.json"), JSON.stringify(stored));
  return dir;
}

function environment(stored?: unknown) {
  const settings = new Settings(profile(stored), PLUGINS, "4.0.0");
  const plugins = { setEnabled: vi.fn(async () => {}), setConfig: vi.fn(async () => {}) };
  const env: ConfigApplyEnvironment = {
    settings,
    plugins: plugins as unknown as PluginHost,
    pluginIds: PLUGINS.map((plugin) => plugin.id),
    applyCore: vi.fn(),
    applyApiServer: vi.fn(async () => {}),
  };
  return { env, plugins, settings };
}

describe("applying a config patch", () => {
  test("applies a changed core section and publishes it", async () => {
    const { env, settings } = environment();
    expect(settings.core("general").autoUpdates).toBe(true);
    // config.json keeps the core fields flat under `options` (one record for every section).
    await applyConfigPatch(env, { options: { autoUpdates: false } });
    expect(settings.core("general").autoUpdates).toBe(false);
    expect(env.applyCore).toHaveBeenCalledTimes(1);
    expect(env.applyCore).toHaveBeenCalledWith(
      "general",
      expect.objectContaining({ autoUpdates: true }),
      expect.objectContaining({ autoUpdates: false }),
    );
  });

  test("enables a plugin by starting it, and only touches what changed", async () => {
    const { env, plugins, settings } = environment();
    await applyConfigPatch(env, { plugins: { "synced-lyrics": { enabled: true } } });
    expect(settings.plugin("synced-lyrics")?.enabled).toBe(true);
    expect(plugins.setEnabled).toHaveBeenCalledWith("synced-lyrics", true);
    expect(plugins.setConfig).not.toHaveBeenCalled();
    // Nothing else changed, so the untouched tray plugin is not restarted.
    expect(plugins.setEnabled).toHaveBeenCalledTimes(1);
  });

  test("hands a plugin's new config to the host once it is already running", async () => {
    const { env, plugins } = environment();
    await applyConfigPatch(env, { plugins: { "synced-lyrics": { enabled: true } } });
    vi.mocked(plugins.setEnabled).mockClear();
    await applyConfigPatch(env, { plugins: { "synced-lyrics": { preciseTiming: false } } });
    expect(plugins.setEnabled).not.toHaveBeenCalled();
    expect(plugins.setConfig).toHaveBeenCalledWith("synced-lyrics", expect.objectContaining({ preciseTiming: false }));
  });

  test("rebinds the API server when its own section changes", async () => {
    const { env, settings } = environment();
    await applyConfigPatch(env, { plugins: { "api-server": { enabled: true, port: 9911 } } });
    expect(settings.core("apiServer")).toMatchObject({ enabled: true, port: 9911 });
    expect(env.applyApiServer).toHaveBeenCalledTimes(1);
  });

  test("keeps unknown keys and does no work for a patch that changes nothing", async () => {
    const { env, plugins, settings } = environment();
    await applyConfigPatch(env, { future: { option: 1 } });
    expect(settings.all().future).toEqual({ option: 1 });
    expect(env.applyCore).not.toHaveBeenCalled();
    expect(env.applyApiServer).not.toHaveBeenCalled();
    expect(plugins.setEnabled).not.toHaveBeenCalled();
    expect(plugins.setConfig).not.toHaveBeenCalled();
  });
});
