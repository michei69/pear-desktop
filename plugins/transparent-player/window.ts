// The window chrome behind the transparent page: a material on Windows 11 and
// macOS. Linux transparency was dropped (it needed global compositing switches
// and was never reliable), so this only ever runs on win32 and darwin.

import type { BrowserWindow } from "electron";

export const OPAQUE_BACKGROUND = "#030303";
const WINDOWS_MATERIALS = ["mica", "acrylic", "tabbed"] as const;
const MACOS_MATERIALS = ["window", "fullscreen-ui", "content", "under-window", "under-page"] as const;

type WindowsMaterial = (typeof WINDOWS_MATERIALS)[number];
type MacosMaterial = (typeof MACOS_MATERIALS)[number];
export type Material = "none" | WindowsMaterial | MacosMaterial;

/** The window calls this plugin makes (a plain fake records them in tests). */
export type WindowChrome = Pick<BrowserWindow, "setBackgroundMaterial" | "setVibrancy" | "setBackgroundColor">;

const includes = <T extends string>(list: readonly T[], value: string): value is T => (list as readonly string[]).includes(value);

/**
 * A config written on one platform can hold the other's material. Leave the
 * current effect alone then; clearing it would silently remove vibrancy/mica.
 */
export function applyMaterial(window: WindowChrome, material: Material, platform = process.platform) {
  if (platform === "win32" && (material === "none" || includes(WINDOWS_MATERIALS, material))) {
    window.setBackgroundMaterial(includes(WINDOWS_MATERIALS, material) ? material : "none");
  } else if (platform === "darwin" && (material === "none" || includes(MACOS_MATERIALS, material))) {
    window.setVibrancy(includes(MACOS_MATERIALS, material) ? material : null);
  }
}

/** The page paints the tint; the window supplies the material and the darkening behind it. */
export function applyTransparency(window: WindowChrome, material: Material, opacity: number, platform = process.platform) {
  applyMaterial(window, material, platform);
  window.setBackgroundColor(`rgba(0, 0, 0, ${opacity / 100})`);
}

export function resetTransparency(window: WindowChrome, platform = process.platform) {
  applyMaterial(window, "none", platform);
  window.setBackgroundColor(OPAQUE_BACKGROUND);
}
