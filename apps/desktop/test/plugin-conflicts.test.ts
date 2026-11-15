import { describe, expect, test } from "vitest";
import { resolvePluginConflicts } from "../src/main/plugin-conflicts.ts";

const plugin = (id: string, conflicts?: Parameters<typeof resolvePluginConflicts>[0][number]["conflicts"]) => ({ id, conflicts });
const enabled = (...ids: string[]) => new Set(ids);

describe("plugin conflicts", () => {
  test("a directional conflict disables the declaring plugin, on or off", () => {
    const plugins = [plugin("quality-changer", [{ id: "audio-only", reason: "quality would be overridden" }]), plugin("audio-only")];
    const block = new Map([["quality-changer", { id: "audio-only", reason: "quality would be overridden" }]]);
    expect(resolvePluginConflicts(plugins, enabled("audio-only", "quality-changer"))).toEqual(block);
    expect(resolvePluginConflicts(plugins, enabled("audio-only"))).toEqual(block);
    expect(resolvePluginConflicts(plugins, enabled("quality-changer"))).toEqual(new Map());
  });

  test("a mutual conflict blocks whichever of the pair is off", () => {
    const plugins = [
      plugin("album-color-theme", [{ id: "transparent-player", mutual: true, reason: "one background" }]),
      plugin("transparent-player"),
    ];
    expect(resolvePluginConflicts(plugins, enabled("album-color-theme"))).toEqual(
      new Map([["transparent-player", { id: "album-color-theme", reason: "one background" }]]),
    );
    expect(resolvePluginConflicts(plugins, enabled("transparent-player"))).toEqual(
      new Map([["album-color-theme", { id: "transparent-player", reason: "one background" }]]),
    );
    expect(resolvePluginConflicts(plugins, enabled())).toEqual(new Map());
  });

  test("a stored-both-on mutual pair resolves by catalog order", () => {
    const plugins = [
      plugin("album-color-theme", [{ id: "transparent-player", mutual: true, reason: "one background" }]),
      plugin("transparent-player"),
    ];
    expect(resolvePluginConflicts(plugins, enabled("album-color-theme", "transparent-player"))).toEqual(
      new Map([["transparent-player", { id: "album-color-theme", reason: "one background" }]]),
    );
  });

  test("a blocked plugin doesn't block through a mutual pair", () => {
    const plugins = [
      plugin("a", [{ id: "b", reason: "a yields" }]),
      plugin("b", [{ id: "c", mutual: true, reason: "b and c" }]),
      plugin("c"),
    ];
    const blocked = resolvePluginConflicts(plugins, enabled("a", "b", "c"));
    expect(blocked.get("a")).toEqual({ id: "b", reason: "a yields" });
    expect(blocked.get("c")).toEqual({ id: "b", reason: "b and c" });
    expect(blocked.has("b")).toBe(false);
  });

  test("disabled plugins never block or yield", () => {
    const plugins = [plugin("a", [{ id: "b", reason: "a yields" }]), plugin("b")];
    expect(resolvePluginConflicts(plugins, enabled())).toEqual(new Map());
  });
});
