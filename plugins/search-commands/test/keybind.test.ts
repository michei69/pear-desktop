import { describe, expect, test } from "vitest";
import { schema } from "../config.ts";
import { matchesKeybind, parseKeybind } from "../keybind.ts";

/** Only the fields `matchesKeybind` reads. */
const key = (init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent =>
  ({
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  }) as KeyboardEvent;

describe("parseKeybind", () => {
  test("reads modifiers and the key", () => {
    expect(parseKeybind("Ctrl+/")).toEqual({ ctrl: true, meta: false, alt: false, shift: false, key: "/" });
    expect(parseKeybind("Alt+Shift+Space")).toEqual({ ctrl: false, meta: false, alt: true, shift: true, key: " " });
  });

  test("is case and spacing insensitive", () => {
    expect(parseKeybind("  ctrl + K ")).toEqual({ ctrl: true, meta: false, alt: false, shift: false, key: "k" });
  });

  test("rejects what it cannot match", () => {
    for (const input of ["", "+", "Ctrl+", "Meta+Foo+K", "Ctrl+Hyper+K"]) {
      expect(parseKeybind(input)).toBeUndefined();
    }
  });
});

describe("matchesKeybind", () => {
  test("requires the exact modifier set", () => {
    const bind = parseKeybind("Ctrl+Shift+K");
    expect(bind).toBeDefined();

    expect(matchesKeybind(bind!, key({ key: "k", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matchesKeybind(bind!, key({ key: "k", ctrlKey: true }))).toBe(false);
    expect(matchesKeybind(bind!, key({ key: "k", ctrlKey: true, shiftKey: true, altKey: true }))).toBe(false);
  });

  test("a symbol binding ignores shift, because the symbol carries it", () => {
    const bind = parseKeybind("Ctrl+/");
    expect(bind).toBeDefined();

    // Unshifted on a US layout, shift+7 on a German one; both report `/`.
    expect(matchesKeybind(bind!, key({ key: "/", ctrlKey: true }))).toBe(true);
    expect(matchesKeybind(bind!, key({ key: "/", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matchesKeybind(bind!, key({ key: "/", ctrlKey: true, altKey: true }))).toBe(false);
  });

  test("a letter binding keeps shift significant", () => {
    const bind = parseKeybind("Ctrl+K");
    expect(bind).toBeDefined();

    expect(matchesKeybind(bind!, key({ key: "k", ctrlKey: true }))).toBe(true);
    expect(matchesKeybind(bind!, key({ key: "K", ctrlKey: true, shiftKey: true }))).toBe(false);
  });
});

describe("the advertised default", () => {
  test("is an accelerator this module can match", () => {
    // Read from the plugin's own config, so changing or dropping what it
    // advertises in its settings fails here.
    const bind = parseKeybind(schema.openKeybind.default);
    expect(bind).toBeDefined();
    expect(bind!.key).toBe("/");
    // `CmdOrCtrl` resolves to whichever modifier this platform uses.
    expect(bind!.ctrl !== bind!.meta).toBe(true);
    expect(matchesKeybind(bind!, key({ key: "/", ctrlKey: bind!.ctrl, metaKey: bind!.meta }))).toBe(true);
    expect(matchesKeybind(bind!, key({ key: "/", altKey: true }))).toBe(false);
  });
});
