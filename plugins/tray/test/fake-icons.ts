// The tray bitmaps are decoded PNGs; tests only need to count the decodes.

import { vi } from "vitest";

export const trayIconBitmap = vi.fn((_size: number, _paused = false, _white = false) => Buffer.alloc(4));

export const ytmTrayIconBitmap = vi.fn((_size: number, _paused = false) => Buffer.alloc(4));
