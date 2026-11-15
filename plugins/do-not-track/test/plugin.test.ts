import { isEnabledByDefault } from "@pear/sdk";
import { describe, expect, test, vi } from "vitest";
import doNotTrack from "../index.ts";
import { needsBlocklists, schema } from "../schema.ts";

vi.mock("electron", () => ({
  dialog: { showMessageBox: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })) },
  net: { fetch: vi.fn() },
  shell: { openPath: vi.fn() },
}));

describe("do-not-track defaults", () => {
  test("a fresh profile has the blocker on", () => {
    expect(isEnabledByDefault(doNotTrack, "linux")).toBe(true);
    expect(isEnabledByDefault(doNotTrack, "win32")).toBe(true);
    expect(isEnabledByDefault(doNotTrack, "darwin")).toBe(true);
  });

  test("the default profile is Balanced", () => {
    expect(schema.blocker.default).toBe("Balanced");
    expect(schema.blocker.options.map((option) => option.value)).toEqual(["Lite", "Balanced", "Strict"]);
  });

  test("Lite only prunes the player until custom lists are on; Balanced and Strict filter requests", () => {
    expect(needsBlocklists({ blocker: "Lite", customEnabled: false })).toBe(false);
    expect(needsBlocklists({ blocker: "Lite", customEnabled: true })).toBe(true);
    expect(needsBlocklists({ blocker: "Balanced", customEnabled: false })).toBe(true);
    expect(needsBlocklists({ blocker: "Strict", customEnabled: false })).toBe(true);
  });
});
