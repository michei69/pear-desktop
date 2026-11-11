import { onPlatform } from "@pear/sdk";
import { describe, expect, test } from "vitest";
import { schema } from "../schema.ts";
import { TOAST_STYLES } from "../toast.ts";

describe("notifications settings", () => {
  test("fresh profiles keep the tray plugin's click and show button labels (master defaults)", () => {
    expect(schema.trayControls.default).toBe(false);
    expect(schema.hideButtonText.default).toBe(false);
    expect(schema.interactive.default).toBe(true);
    expect(schema.hoverControls.default).toBe(true);
    expect(schema.refreshOnPlayPause.default).toBe(false);
    expect(schema.unpauseNotification.default).toBe(false);
    expect(schema.urgency.default).toBe("normal");
    expect(schema.toastStyle.default).toBe("logo");
  });

  test("the Linux-only priority is hidden on Windows and macOS", () => {
    expect(schema.urgency.platforms).toEqual(["linux"]);
    expect(onPlatform(schema.urgency.platforms, "linux")).toBe(true);
    expect(onPlatform(schema.urgency.platforms, "win32")).toBe(false);
    expect(onPlatform(schema.urgency.platforms, "darwin")).toBe(false);
  });

  test("Windows-only options are hidden elsewhere", () => {
    for (const field of [schema.toastStyle, schema.trayControls, schema.hoverControls, schema.hideButtonText]) {
      expect(field.platforms).toEqual(["win32"]);
      expect(onPlatform(field.platforms, "linux")).toBe(false);
      expect(onPlatform(field.platforms, "darwin")).toBe(false);
    }
    // Playback buttons work wherever the OS shows notification actions.
    expect(schema.interactive.platforms).toBeUndefined();
    expect(schema.unpauseNotification.platforms).toBeUndefined();
  });

  test("every toast style pear-desktop had is offered", () => {
    expect(schema.toastStyle.options.map((option) => option.value)).toEqual([...TOAST_STYLES]);
  });
});
