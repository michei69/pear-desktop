import { config, definePlugin } from "@pear/sdk";
import { DEFAULT_THRESHOLD_MB, liveBytes, thresholdBytesFor } from "./usage.ts";

const CHECK_INTERVAL_MS = 60_000;
/** Don't clear twice in a row while the caches stay above the threshold. */
const CLEAR_COOLDOWN_MS = 10 * 60_000;

const USAGE = "window.pearPerf?.getResourceUsage()";
const CLEAR = "window.pearPerf?.clearCache()";

export default definePlugin({
  id: "memory-saver",
  name: "Memory saver",
  description: "Drops the renderer's caches while the window is hidden, once they grow past a threshold.",
  config: {
    thresholdMB: config.number(DEFAULT_THRESHOLD_MB, {
      // pear-desktop's texts live under settings.threshold(.label/-description);
      // this field's key is thresholdMB, so the translation files need the
      // values copied onto plugins.memory-saver.settings.thresholdMB.*.
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
      // The cooldown lives in this `start` closure, so a re-enable (a fresh
      // plugin instance) starts with lastClearAt = 0 and can clear at once.
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
