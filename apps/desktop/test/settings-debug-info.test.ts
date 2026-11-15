// The copied debug report and the live flag overrides it prints: the in-page
// settings edits flags through the session, so the report must read the current
// overrides rather than the ones the page was loaded with.

import type { Flags } from "@pear/sdk/core-config";
import type { AppDebugInfo } from "@pear/sdk/protocol";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { SettingsModel, SiteFlags } from "../../../packages/ui/src/model.ts";
import {
  buildDebugInfo,
  keepFlagOverridesLive,
  liveFlagOverrides,
  storedFlagOverrides,
} from "../../../packages/ui/src/settings/debug-info.ts";

const META: AppDebugInfo = {
  name: "Pear Desktop",
  version: "4.0.0",
  build: "beta 1a2b3c4",
  copyright: "© test",
  platform: "linux",
  arch: "x64",
  osVersion: "Linux 6.0",
  versions: { electron: "45.0.0", chrome: "140.0.0", node: "24.0.0" },
  cpu: { model: "Test CPU", threads: 8 },
  gpu: { renderer: "Test GPU", vendor: "Test", features: { gpu_compositing: "enabled" } },
  memory: { main: 100 * 1024, renderers: 200 * 1024, gpu: 50 * 1024 },
};

/** A settings model holding just the site section's stored flag list (what the report reads). */
function modelWith(entries: string[]): SettingsModel {
  return { core: (section: string) => (section === "site" ? { config: { siteFlags: entries } } : undefined) } as unknown as SettingsModel;
}

const globalWithWindow = globalThis as { window?: unknown };
const originalWindow = globalWithWindow.window;
beforeAll(() => {
  globalWithWindow.window = {};
});
afterAll(() => {
  if (originalWindow === undefined) delete globalWithWindow.window;
  else globalWithWindow.window = originalWindow;
});

describe("buildDebugInfo", () => {
  test("lists the flags with their values and marks the overridden ones", () => {
    const report = buildDebugInfo(META, [], { alpha: true, beta: 2, gamma: "text" }, { beta: 3, added: false });
    const lines = report.split("\n");
    expect(lines).toContain("alpha: true");
    expect(lines).toContain("beta: 3 (overridden)");
    expect(lines).toContain('gamma: "text"');
    expect(lines).toContain("added: false (overridden)");
    expect(report).toContain("Feature flags (4, 2 overridden):");
  });

  test("prints non-scalar values as JSON", () => {
    const report = buildDebugInfo(META, [], {}, { payload: { a: 1, list: [1, 2] } });
    expect(report).toContain('payload: {"a":1,"list":[1,2]} (overridden)');
  });

  test("carries the app, machine and plugin lines", () => {
    const report = buildDebugInfo(META, ["Tray", "Crossfade"], {}, {});
    expect(report).toContain("Pear Desktop v4.0.0 (beta 1a2b3c4)");
    expect(report).toContain("Plugins (2): Tray, Crossfade");
    expect(report).toContain("Memory: 350 MB total");
    expect(report).not.toContain("Feature flags");
  });
});

describe("live flag overrides", () => {
  test("the overlay's report follows the overrides written during the session", () => {
    const entries = ["old=false"];
    const model = {
      core: (section: string) => (section === "site" ? { config: { siteFlags: entries } } : undefined),
      // What the page runtime hands over: the served flags and the load-time overrides.
      siteFlags: () => ({ served: { old: true, stayed: false }, overrides: { old: false } }),
    } as unknown as SettingsModel;

    const live = keepFlagOverridesLive(model);
    const report = () => {
      const page = live.siteFlags!();
      return buildDebugInfo(META, [], page.served as Flags, liveFlagOverrides(live, page));
    };

    expect(report()).toContain("old: false (overridden)");
    entries.push('fresh=json:{"n":1}');
    expect(report()).toContain('fresh: {"n":1} (overridden)');
    // Undoing the override drops it from the report; the page's own value stays.
    entries.splice(0, entries.length);
    const after = report();
    expect(after).toContain("old: true");
    expect(after).not.toContain("(overridden)");
  });

  test("performance mode's flags survive the reconstruction while the user's do not", () => {
    const entries = ["performance_overridden=false"];
    const model = {
      core: (section: string) => (section === "site" ? { config: { siteFlags: entries } } : undefined),
      // `performance` is forced by the page, `performance_overridden` was the user's at load.
      siteFlags: () => ({ served: {}, overrides: { performance: false, performance_overridden: false } }),
    } as unknown as SettingsModel;
    const live = keepFlagOverridesLive(model);
    // Still overridden now: the current list is layered over performance mode's flags.
    expect(live.siteFlags!().overrides).toEqual({ performance: false, performance_overridden: false });
    // Undone: the user's flag goes, performance mode's stays.
    entries.splice(0, entries.length);
    expect(live.siteFlags!().overrides).toEqual({ performance: false });
  });

  test("a page reporting the overrides as a getter is read at call time", () => {
    let overrides: Flags = { before: true };
    const page: SiteFlags = { served: {}, overrides: () => overrides };
    const live = keepFlagOverridesLive({
      core: () => undefined,
      siteFlags: () => page,
    } as unknown as SettingsModel);
    expect(live.siteFlags!().overrides).toEqual({ before: true });
    overrides = { after: true };
    expect(live.siteFlags!().overrides).toEqual({ after: true });
  });

  test("without a page the saved overrides stand in (the standalone window)", () => {
    expect(liveFlagOverrides(modelWith(["flag=json:[1,2]"]), undefined)).toEqual({ flag: [1, 2] });
  });
});
