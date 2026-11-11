import { describe, expect, test, vi } from "vitest";
import { nextShortcutIcon } from "../src/main/app-identity.ts";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp" }, shell: {} }));

const exe = "C:\\Program Files\\Music\\music.exe";
const ours = "C:\\Users\\me\\AppData\\Roaming\\Music\\icon-ytm.ico";

describe("Windows shortcut icons", () => {
  const next = (current: string, useYtmIcons: boolean) => nextShortcutIcon(current, exe, ours, useYtmIcons);

  test("uses Music's .ico while the option is on, for default and our icons", () => {
    expect(next("", true)).toBe(`${ours},0`);
    expect(next(exe, true)).toBe(`${ours},0`);
    expect(next(ours, true)).toBe(`${ours},0`);
    expect(next(`${ours},0`, true)).toBe(`${ours},0`);
    // Case-insensitive, as Windows paths are.
    expect(next(exe.toUpperCase(), true)).toBe(`${ours},0`);
  });

  test("leaves somebody else's icon alone", () => {
    expect(next("C:\\Icons\\custom.ico", true)).toBeNull();
    expect(next("C:\\Icons\\custom.ico", false)).toBeNull();
  });

  test("option off resets the shortcuts still on our icon to the exe's", () => {
    expect(next(ours, false)).toBe(exe);
    expect(next(`${ours},0`, false)).toBe(exe);
    expect(next("", false)).toBeNull();
    expect(next(exe, false)).toBeNull();
  });
});
