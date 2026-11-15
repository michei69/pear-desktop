// The renderer's Blink cache, exposed by the preload for the main window's
// hidden-cache release.

export interface PagePerformance {
  /** Drops the renderer's resource caches. */
  clearCache(): void;
}

declare global {
  interface Window {
    pearPerf?: PagePerformance;
  }
}
