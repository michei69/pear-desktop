// The page-side flag installer: it patches ytcfg before YTM's own script runs,
// re-applies the overrides after a later EXPERIMENT_FLAGS payload, and puts the
// page's values back when an override is removed. pear-desktop locked these with
// tests; they are the subtle half of the Flags section.

import { describe, expect, test } from "vitest";
import { overrideSiteFlags } from "../../../packages/page/src/site-flags.ts";

/** The page's ytcfg as far as the installer touches it. */
interface FakeYtcfg {
  data_?: { EXPERIMENT_FLAGS?: Record<string, unknown> };
  set?: (...args: unknown[]) => unknown;
  __pearFlags?: boolean;
}

const globalScope = globalThis as { window?: unknown };

/** A fresh page window for one installer run. */
function pageWindow() {
  const page: Record<string, unknown> = {};
  globalScope.window = page;
  return page;
}

const flagsOf = (page: Record<string, unknown>) => (page.ytcfg as FakeYtcfg).data_?.EXPERIMENT_FLAGS ?? {};

describe("overrideSiteFlags", () => {
  test("adopts a config the page built before the runtime ran, then applies the overrides", () => {
    const page = pageWindow();
    const installed = overrideSiteFlags({ flag_a: false }, false);
    page.ytcfg = { data_: { EXPERIMENT_FLAGS: { flag_a: true, flag_b: true } } };

    // The page's values are kept for undoing, the overrides are what its code reads.
    expect(installed.served).toEqual({ flag_a: true, flag_b: true });
    expect(installed.overrides).toEqual({ flag_a: false });
    expect(flagsOf(page)).toEqual({ flag_a: false, flag_b: true });
  });

  test("a later EXPERIMENT_FLAGS payload cannot drop the overrides", () => {
    const page = pageWindow();
    const installed = overrideSiteFlags({ flag_a: false }, false);
    // ytcfg.set stores the payload, then the installer's wrapper re-applies the overrides.
    const ytcfg: FakeYtcfg = {
      data_: { EXPERIMENT_FLAGS: { flag_a: true } },
      set: (key, value) => {
        if (key === "EXPERIMENT_FLAGS") ytcfg.data_!.EXPERIMENT_FLAGS = value as Record<string, unknown>;
      },
    };
    page.ytcfg = ytcfg;

    ytcfg.set?.("EXPERIMENT_FLAGS", { flag_a: true, late: 3 });
    expect(flagsOf(page)).toEqual({ flag_a: false, late: 3 });
    // The first value the page served stays the served one; flags it adds later are kept too.
    expect(installed.served).toEqual({ flag_a: true, late: 3 });
  });

  test("removing an override puts the page's own value back", () => {
    const page = pageWindow();
    overrideSiteFlags({ flag_a: false }, false);
    page.ytcfg = { data_: { EXPERIMENT_FLAGS: { flag_a: true } } };
    const live = (page as { __pearFeatureFlags?: { remove(name: string): void } }).__pearFeatureFlags!;

    live.remove("flag_a");
    expect(flagsOf(page).flag_a).toBe(true);
  });

  test("removing an override the page never had drops the flag", () => {
    const page = pageWindow();
    const installed = overrideSiteFlags({}, false);
    page.ytcfg = { data_: { EXPERIMENT_FLAGS: { other: true } } };
    const live = (page as { __pearFeatureFlags?: { set(name: string, value: unknown): void; remove(name: string): void } })
      .__pearFeatureFlags!;

    live.set("added", 5);
    expect(flagsOf(page).added).toBe(5);
    expect(installed.served).not.toHaveProperty("added");
    live.remove("added");
    expect(flagsOf(page)).not.toHaveProperty("added");
    expect(installed.served).not.toHaveProperty("added");
  });

  test("the served snapshot never carries the overrides", () => {
    const page = pageWindow();
    const installed = overrideSiteFlags({ flag_a: "text" }, false);
    page.ytcfg = { data_: { EXPERIMENT_FLAGS: { flag_a: true } } };
    expect(installed.served).toEqual({ flag_a: true });
    expect(installed.overrides).toEqual({ flag_a: "text" });
    expect(flagsOf(page).flag_a).toBe("text");
  });

  test("performance mode's flags are applied under the user's", () => {
    const page = pageWindow();
    const installed = overrideSiteFlags({ kevlar_thumbnail_bg: true }, true);
    page.ytcfg = { data_: { EXPERIMENT_FLAGS: {} } };
    // The user's choice wins over performance mode's value.
    expect(flagsOf(page).kevlar_thumbnail_bg).toBe(true);
    expect(flagsOf(page).kevlar_tuner_thumbnail_factor).toBe(1);
    expect(installed.overrides).toMatchObject({ kevlar_thumbnail_bg: true, kevlar_tuner_thumbnail_factor: 1 });
  });
});
