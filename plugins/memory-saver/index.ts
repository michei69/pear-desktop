import { config, definePlugin } from "@pear/sdk";

const CHECK_INTERVAL_MS = 60_000;
/** Don't clear twice in a row while the caches stay above the threshold. */
const CLEAR_COOLDOWN_MS = 10 * 60_000;
const DEFAULT_THRESHOLD_MB = 64;
const MB = 1024 * 1024;

/** Blink reports one `MemoryUsageDetails` bucket per cache kind. */
type BlinkUsage = Record<string, { liveSize?: number } | undefined>;

/** Sum of the live bytes in Blink's caches; `0` when the renderer returned nothing usable. */
const liveBytes = (usage: unknown) => {
  if (!usage || typeof usage !== "object") return 0;
  let total = 0;
  for (const details of Object.values(usage as BlinkUsage)) {
    if (typeof details?.liveSize === "number") total += details.liveSize;
  }
  return total;
};

/** A stored value that is not a positive number falls back to the default. */
const thresholdBytesFor = (thresholdMB: unknown) => {
  const value = Number(thresholdMB);
  return (Number.isFinite(value) && value > 0 ? value : DEFAULT_THRESHOLD_MB) * MB;
};

const USAGE = "window.pearPerf?.getResourceUsage()";
const CLEAR = "window.pearPerf?.clearCache()";

export default definePlugin({
  id: "memory-saver",
  name: "Memory saver",
  description: "Drops the renderer's caches while the window is hidden, once they grow past a threshold.",
  config: {
    thresholdMB: config.number(DEFAULT_THRESHOLD_MB, {
      label: "Threshold",
      description: "Clear the renderer cache while the window is hidden once the live resource usage exceeds this.",
      min: 8,
      max: 1024,
      step: 8,
      unit: "MB",
    }),
  },
  host: {
    start(ctx) {
      let thresholdBytes = thresholdBytesFor(ctx.config.thresholdMB);
      let lastClearAt = 0;
      let stopped = false;

      const check = async () => {
        const window = ctx.window;
        // Only while the user cannot see the cache being dropped.
        if (stopped || window.isDestroyed() || window.isVisible()) return;
        try {
          const usage = await window.webContents.executeJavaScript(USAGE);
          if (stopped || window.isDestroyed()) return;
          if (liveBytes(usage) < thresholdBytes) return;
          if (Date.now() - lastClearAt < CLEAR_COOLDOWN_MS) return;
          lastClearAt = Date.now();
          await window.webContents.executeJavaScript(CLEAR);
        } catch (error) {
          // The renderer may be gone or mid-navigation; the next tick retries.
          ctx.log.warn("could not check the renderer caches", error);
        }
      };

      const interval = ctx.setInterval(() => void check(), CHECK_INTERVAL_MS);
      ctx.onCleanup(() => {
        stopped = true;
        ctx.clearInterval(interval);
      });
      // The threshold applies live; the interval stays as it is.
      ctx.onConfigChange((next) => {
        thresholdBytes = thresholdBytesFor(next.thresholdMB);
      });
    },
  },
});
