import type {} from "@pear/page";

declare global {
  interface Window {
    /** The player volume and bar position when a resumed track first started playing (audio-controls). */
    __pearFirstPlayingVolume?: { volume: number | undefined; slider: number } | undefined;
  }
}
