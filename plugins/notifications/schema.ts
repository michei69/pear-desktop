// The notifications settings card and its stored options.

import { config, type HostContextOf } from "@pear/sdk";
import { TOAST_STYLES, type ToastStyle } from "./toast.ts";

export const STYLE_LABELS: Record<ToastStyle, string> = {
  logo: "Logo",
  banner_centered_top: "Banner centered top",
  hero: "Hero",
  banner_top_custom: "Banner top custom",
  banner_centered_bottom: "Banner centered bottom",
  banner_bottom: "Banner bottom",
  legacy: "Legacy",
};

export const schema = {
  unpauseNotification: config.bool(false, { label: "Also notify when resuming" }),
  urgency: config.select(
    "normal",
    [
      { value: "low", label: "Low" },
      { value: "normal", label: "Normal" },
      { value: "critical", label: "High" },
    ],
    { label: "Priority", description: "Linux only: how prominently the desktop shows it.", platforms: ["linux"] },
  ),
  interactive: config.bool(true, {
    label: "Playback buttons",
    description: "Windows and macOS: previous, play/pause and next buttons in the notification.",
  }),
  refreshOnPlayPause: config.bool(false, {
    label: "Update after play/pause from the notification",
    description: "Show it again with the opposite button after using its play/pause button.",
  }),
  toastStyle: config.select(
    "logo",
    TOAST_STYLES.map((value) => ({ value, label: STYLE_LABELS[value] })),
    { label: "Toast style", description: "How the notification with buttons looks.", platforms: ["win32"], variant: "dropdown" },
  ),
  trayControls: config.bool(false, {
    label: "Open and close it from the tray",
    description: "Clicking the tray icon shows or hides the notification; double-clicking shows or hides the window.",
    platforms: ["win32"],
  }),
  hoverControls: config.bool(true, {
    label: "Mini player on tray hover",
    description: "Hover the tray icon to see the artwork and the previous, play/pause and next controls.",
    platforms: ["win32"],
  }),
  hideButtonText: config.bool(false, {
    label: "Hide button text",
    description: "Windows: show only the icons on the notification's buttons.",
    platforms: ["win32"],
  }),
};

export type Ctx = HostContextOf<typeof schema>;
