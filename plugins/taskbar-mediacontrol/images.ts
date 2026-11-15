// The thumbar's bitmaps, kept out of the plugin definition so the page bundle
// never pulls them in: `nativeImage` and the embedded icons are host-only, and
// a module-level `embed(...)` would still reach the page (the split plugin keeps
// impure declarations even when nothing references them).

import { embed } from "@pear/sdk/macros" with { type: "macro" };
import { nativeImage, nativeTheme, type NativeImage } from "electron";

export type Icon = "play" | "pause" | "next" | "previous" | "like" | "dislike" | "likeHollow" | "dislikeHollow";
export type Icons = Record<Icon, NativeImage>;

// pear-desktop's icons, embedded at build time (base64) in both taskbar colors,
// so the thumbar matches the fork exactly without ?asset imports.
const ICON_FILES: Record<Icon, { black: string; white: string }> = {
  play: {
    black: embed("media-icons-black/play.png"),
    white: embed("media-icons-white/play.png"),
  },
  pause: {
    black: embed("media-icons-black/pause.png"),
    white: embed("media-icons-white/pause.png"),
  },
  next: {
    black: embed("media-icons-black/next.png"),
    white: embed("media-icons-white/next.png"),
  },
  previous: {
    black: embed("media-icons-black/previous.png"),
    white: embed("media-icons-white/previous.png"),
  },
  like: {
    black: embed("media-icons-black/like.png"),
    white: embed("media-icons-white/like.png"),
  },
  dislike: {
    black: embed("media-icons-black/dislike.png"),
    white: embed("media-icons-white/dislike.png"),
  },
  likeHollow: {
    black: embed("media-icons-black/like-hollow.png"),
    white: embed("media-icons-white/like-hollow.png"),
  },
  dislikeHollow: {
    black: embed("media-icons-black/dislike-hollow.png"),
    white: embed("media-icons-white/dislike-hollow.png"),
  },
};

export function renderIcons(): Icons {
  const dark = nativeTheme.shouldUseDarkColors;
  return Object.fromEntries(
    (Object.keys(ICON_FILES) as Icon[]).map((name) => [
      name,
      nativeImage.createFromBuffer(Buffer.from(dark ? ICON_FILES[name].white : ICON_FILES[name].black, "base64")),
    ]),
  ) as Icons;
}
