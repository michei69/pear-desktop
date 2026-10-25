// pear-desktop's icons (assets/), embedded at build time so nothing depends on
// where the assets end up at runtime.

import { nativeImage } from "electron";
import { embed } from "./macros.ts" with { type: "macro" };

const APP_ICON = embed("generated/icons/png/256x256.png");
/** Music's own logo (generated/icons/win/icon-ytm.ico only matters to shortcuts). */
const YTM_APP_ICON = embed("icon-ytm.png");
const TRAY_ICONS = {
  playing: { colored: embed("tray.png"), white: embed("tray-white.png") },
  paused: { colored: embed("tray-paused.png"), white: embed("tray-paused-white.png") },
};
const YTM_TRAY_ICONS = { playing: embed("tray-ytm.png"), paused: embed("tray-paused-ytm.png") };

function bitmap(base64: string, size: number): Buffer {
  const image = nativeImage.createFromBuffer(Buffer.from(base64, "base64"));
  return image.resize({ width: size, height: size, quality: "best" }).toBitmap();
}

/** The app icon as a bitmap: `nativeImage.createFromBitmap(pearIconBitmap(32), { width: 32, height: 32 })`. */
export function pearIconBitmap(size: number): Buffer {
  return bitmap(APP_ICON, size);
}

/** Music's app icon, for `appearance.useYtmIcons`. */
export function ytmIconBitmap(size: number): Buffer {
  return bitmap(YTM_APP_ICON, size);
}

/** The tray icon, in its own colors or white for dark or tinted menu bars (the macOS default). */
export function trayIconBitmap(size: number, paused = false, white = process.platform === "darwin"): Buffer {
  const icons = paused ? TRAY_ICONS.paused : TRAY_ICONS.playing;
  return bitmap(white ? icons.white : icons.colored, size);
}

/** Music's tray icon, for `appearance.useYtmIcons`. */
export function ytmTrayIconBitmap(size: number, paused = false): Buffer {
  return bitmap(paused ? YTM_TRAY_ICONS.paused : YTM_TRAY_ICONS.playing, size);
}
