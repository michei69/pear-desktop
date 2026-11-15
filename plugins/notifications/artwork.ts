// The artwork of a notification: @pear/sdk/artwork decodes and caches it once
// per URL, shared with the Touch Bar and the Windows media control; the square
// toast styles then get a centered crop.

import { artworkImage } from "@pear/sdk/artwork";
import type { NativeImage } from "electron";

/** The size notifications and the mini-player show the artwork at. */
export const ICON_SIZE = 256;

/** The artwork: a centered square like pear-desktop's "logo" style, or as is (banners). */
export async function artwork(url: string | undefined, square = true): Promise<NativeImage | undefined> {
  if (!url) return;
  try {
    const image = await artworkImage(url);
    if (image.isEmpty()) return;
    if (!square) return image;
    const { width, height } = image.getSize();
    const side = Math.min(width, height);
    const cropped = image.crop({ x: Math.round((width - side) / 2), y: Math.round((height - side) / 2), width: side, height: side });
    return cropped.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: "best" });
  } catch {
    // A failed cover is cosmetic: the app icon stands in (see index.ts).
    return;
  }
}
