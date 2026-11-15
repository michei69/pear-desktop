import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { definePlugin } from "@pear/sdk";
import { describe, expect, test, vi } from "vitest";
import { Settings } from "../src/main/config.ts";
import { PluginHost } from "../src/main/plugins.ts";
import { fakeHostEnvironment } from "./plugin-host.ts";

vi.mock("electron", () => ({}));

function setup(plugins: ConstructorParameters<typeof PluginHost>[0]) {
  const userData = mkdtempSync(join(tmpdir(), "pear-conflicts-"));
  const settings = new Settings(userData, plugins, "4.0.0");
  const host = new PluginHost(plugins, settings, "linux");
  host.attach(fakeHostEnvironment());
  return host;
}

const blocker = (started: () => void) =>
  definePlugin({
    id: "a-blocker",
    name: "Blocker",
    enabledByDefault: true,
    host: {
      start() {
        started();
      },
    },
  });

const yields = (started: () => void) =>
  definePlugin({
    id: "b-yields",
    name: "Yields",
    conflicts: [{ id: "a-blocker", reason: "the blocker owns it" }],
    host: {
      start() {
        started();
      },
    },
  });

describe("plugin conflicts in the host", () => {
  test("an enabled blocker keeps the conflicting plugin off and reports why", async () => {
    const a = vi.fn();
    const b = vi.fn();
    const host = setup([blocker(a), yields(b)]);

    expect(host.states()["b-yields"]).toMatchObject({ enabled: false, blockedBy: { id: "a-blocker", reason: "the blocker owns it" } });
    expect(await host.setEnabled("b-yields", true)).toMatchObject({ enabled: false });
    expect(b).not.toHaveBeenCalled();

    await host.setEnabled("a-blocker", false);
    expect(host.states()["b-yields"]?.blockedBy).toBeUndefined();
    expect(await host.setEnabled("b-yields", true)).toMatchObject({ enabled: true });
    expect(b).toHaveBeenCalledOnce();
  });

  test("enabling a blocker stops the plugin it conflicts with", async () => {
    const a = vi.fn();
    const b = vi.fn();
    const host = setup([blocker(a), yields(b)]);
    await host.setEnabled("a-blocker", false);
    await host.setEnabled("b-yields", true);
    expect(b).toHaveBeenCalledOnce();

    const blocked = await host.setEnabled("a-blocker", true);
    expect(blocked.enabled).toBe(true);
    expect(host.states()["b-yields"]?.enabled).toBe(false);
  });

  test("a sibling conflict must not stop a restart-required plugin live", async () => {
    const cleanup = vi.fn();
    const restartPlugin = definePlugin({
      id: "r",
      name: "R",
      enabledByDefault: true,
      conflicts: [{ id: "a-blocker", reason: "r yields" }],
      host: {
        beforeReady() {},
        start() {
          return cleanup;
        },
      },
    });
    const a = vi.fn();
    const host = setup([restartPlugin, blocker(a)]);

    expect(host.states().r?.blockedBy?.id).toBe("a-blocker");
    await host.setEnabled("a-blocker", true);
    expect(host.states().r?.enabled).toBe(false);
    expect(cleanup).not.toHaveBeenCalled();
  });

  test("a page-only restart-required plugin keeps its launch state", async () => {
    const plugin = definePlugin({
      id: "page-only",
      name: "Page only",
      enabledByDefault: true,
      restartRequired: true,
      page: {
        start() {},
      },
    });
    const host = setup([plugin]);
    expect(host.meta()["page-only"]).toMatchObject({ restartRequired: true, runningAtLaunch: true });
    await host.setEnabled("page-only", false);
    expect(host.states()["page-only"]?.enabled).toBe(false);
    expect(host.meta()["page-only"]?.runningAtLaunch).toBe(true);
  });

  test("a restart-required plugin changes only after the next launch", async () => {
    const cleanup = vi.fn();
    const plugin = definePlugin({
      id: "r",
      name: "R",
      enabledByDefault: true,
      host: {
        beforeReady() {},
        start() {
          return cleanup;
        },
      },
    });
    const host = setup([plugin]);
    expect(host.meta().r?.restartRequired).toBe(true);

    const state = await host.setEnabled("r", false);
    expect(state.enabled).toBe(false);
    expect(cleanup).not.toHaveBeenCalled();
  });
});
