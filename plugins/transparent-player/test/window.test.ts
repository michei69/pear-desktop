import { describe, expect, test } from "vitest";
import { applyMaterial, applyTransparency, OPAQUE_BACKGROUND, resetTransparency } from "../window.ts";
import { fakeWindow } from "./fake-window.ts";

describe("window materials", () => {
  test("applies the Windows materials and the opacity tint", () => {
    const window = fakeWindow();
    applyTransparency(window, "mica", 75, "win32");
    expect(window.calls).toEqual(["material:mica", "background:rgba(0, 0, 0, 0.75)"]);
  });

  test("applies the macOS vibrancy and clears it for none", () => {
    const window = fakeWindow();
    applyMaterial(window, "under-window", "darwin");
    applyMaterial(window, "none", "darwin");
    expect(window.calls).toEqual(["vibrancy:under-window", "vibrancy:null"]);
  });

  test("leaves the current effect alone for a material of the other platform", () => {
    const windows = fakeWindow();
    applyMaterial(windows, "window", "win32");
    expect(windows.calls).toEqual([]);
    const macos = fakeWindow();
    applyMaterial(macos, "mica", "darwin");
    expect(macos.calls).toEqual([]);
  });

  test("only tints, it does not touch window chrome on Linux", () => {
    const window = fakeWindow();
    applyTransparency(window, "mica", 50, "linux");
    expect(window.calls).toEqual(["background:rgba(0, 0, 0, 0.5)"]);
  });

  test("reset puts the opaque background back", () => {
    const window = fakeWindow();
    resetTransparency(window, "win32");
    expect(window.calls).toEqual(["material:none", `background:${OPAQUE_BACKGROUND}`]);
  });
});
