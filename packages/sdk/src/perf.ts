// The renderer's Blink cache, exposed by the preload for the memory saver.

/** One cache kind Blink reports; `liveSize` is its size in bytes. */
export type BlinkUsage = Record<string, { liveSize?: number } | undefined>;

export interface PagePerformance {
  /** Blink's live resource-cache usage, per cache kind. */
  getResourceUsage(): unknown;
  /** Drops the renderer's resource caches. */
  clearCache(): void;
}

declare global {
  interface Window {
    pearPerf?: PagePerformance;
  }
}
