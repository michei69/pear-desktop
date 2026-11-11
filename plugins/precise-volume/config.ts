// The plugin's settings schema, apart from the entry file so the host half and
// its tests can read it without the style macro.

import { config } from "@pear/sdk";

export const schema = {
  steps: config.number(1, { label: "Step", min: 1, max: 100, step: 1, unit: "%" }),
  wheel: config.bool(true, { label: "Scroll over the player to change volume" }),
  arrowsShortcut: config.bool(true, { label: "Arrow up / down change volume" }),
  showHud: config.bool(true, { label: "Show the volume while changing it" }),
  volumeUp: config.shortcut("", { label: "Global shortcut: volume up" }),
  volumeDown: config.shortcut("", { label: "Global shortcut: volume down" }),
  /** The last volume, restored on the next launch (pear-desktop's savedVolume). -1 until one is saved. */
  savedVolume: config.number(-1, { label: "Saved volume", hidden: true }),
};

/** Whether `value` is a volume the plugin can restore. */
export function isVolume(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}
