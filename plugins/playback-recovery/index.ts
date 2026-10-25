import { config, definePlugin } from "@pear/sdk";

const WATCHDOG_MS = 3000;
/** Time a recovery gets to settle before the watchdog looks again. */
const SETTLE_MS = 4000;
/** Extra time after skipping a dead track, before recovery resumes. */
const NEXT_SETTLE_MS = 5000;

export default definePlugin({
  id: "playback-recovery",
  name: "Playback recovery",
  description: "Recovers playback that stalls, freezes or errors, skipping the track after repeated failures.",
  config: {
    stallTimeoutMs: config.number(8000, {
      label: "Stall timeout",
      description: "How long playback may make no progress before it is restarted.",
      min: 1000,
      max: 30000,
      step: 500,
      unit: "ms",
    }),
    maxRetries: config.number(5, {
      label: "Retries before skipping",
      description: "After this many recovery attempts the track is skipped; a clean second of playback resets the count.",
      min: 1,
      max: 20,
      step: 1,
    }),
    logToConsole: config.bool(true, { label: "Log to the console" }),
  },
  page: (ctx) => {
    let hooks: AbortController | undefined;
    let hooked: HTMLVideoElement | null = null;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
    let consecutiveFailures = 0;
    let lastGoodAt = Date.now();
    let recovering = false;

    const log = (message: string) => {
      if (ctx.config.logToConsole) ctx.log.info(message);
    };

    const detach = () => {
      hooks?.abort();
      hooks = undefined;
      hooked = null;
    };

    const attemptRecovery = (reason: string) => {
      if (recovering) return;

      const maxRetries = ctx.config.maxRetries;
      consecutiveFailures++;

      if (consecutiveFailures > maxRetries) {
        log(`Max retries (${maxRetries}) exceeded — skipping to next track`);
        recovering = true;
        consecutiveFailures = 0;
        ctx.player.control({ type: "next" });
        ctx.clearTimeout(recoveryTimer);
        recoveryTimer = ctx.setTimeout(() => {
          recoveryTimer = undefined;
          recovering = false;
          lastGoodAt = Date.now();
        }, NEXT_SETTLE_MS);
        return;
      }

      log(`Recovery attempt ${consecutiveFailures}/${maxRetries} — reason: ${reason}`);
      recovering = true;

      const currentTime = ctx.player.video()?.currentTime ?? ctx.player.state.positionSeconds;
      if (consecutiveFailures <= 2) {
        log("Strategy: seek-to-current");
        if (currentTime > 0) ctx.player.control({ type: "seek", seconds: currentTime });
        ctx.player.control({ type: "play" });
      } else if (consecutiveFailures <= 4) {
        log("Strategy: seek-forward");
        if (currentTime > 0) ctx.player.control({ type: "seek", seconds: currentTime + 1 });
        ctx.player.control({ type: "play" });
      }

      // Give the seek time to reload the stream.
      ctx.clearTimeout(recoveryTimer);
      recoveryTimer = ctx.setTimeout(() => {
        recoveryTimer = undefined;
        recovering = false;
        lastGoodAt = Date.now();
      }, SETTLE_MS);
    };

    function onError() {
      const code = hooked?.error?.code ?? 0;
      const message = hooked?.error?.message ?? "";
      log(`Media error: code=${code} msg="${message}"`);
      attemptRecovery("media-error");
    }

    const watchStall = (reason: string, readyState: number) => {
      log(`${reason} — waiting for recovery...`);
      ctx.clearTimeout(stallTimer);
      stallTimer = ctx.setTimeout(() => {
        stallTimer = undefined;
        const video = ctx.player.video();
        if (video && !video.paused && video.readyState < readyState) {
          log(`${reason} did not resolve`);
          attemptRecovery(reason);
        }
      }, ctx.config.stallTimeoutMs);
    };

    function onStalled() {
      watchStall("stall-timeout", 3);
    }

    function onWaiting() {
      watchStall("buffer-timeout", 2);
    }

    const attach = () => {
      const video = ctx.player.video();
      if (!video || video === hooked) return;
      detach();
      const controller = new AbortController();
      hooks = controller;
      hooked = video;
      const { signal } = controller;
      video.addEventListener("error", onError, { signal });
      video.addEventListener("stalled", onStalled, { signal });
      video.addEventListener("waiting", onWaiting, { signal });
    };

    // A re-created <video> (navigation, ads) needs the listeners again.
    ctx.observe("app", { childList: true, subtree: true }, attach);
    attach();

    ctx.player.on("timeUpdate", () => {
      const video = ctx.player.video();
      if (video && video.currentTime > 0 && !video.paused) {
        lastGoodAt = Date.now();
        consecutiveFailures = 0;
        recovering = false;
      }
    });

    ctx.player.on("statusChange", (status) => {
      if (status === "playing") lastGoodAt = Date.now();
    });

    ctx.player.on("trackChange", () => {
      consecutiveFailures = 0;
      recovering = false;
      lastGoodAt = Date.now();
      ctx.clearTimeout(stallTimer);
      stallTimer = undefined;
      ctx.clearTimeout(recoveryTimer);
      recoveryTimer = undefined;
      attach();
    });

    // The watchdog covers stalls no media event reports.
    ctx.setInterval(() => {
      if (recovering) return;
      const { status, ad } = ctx.player.state;
      if (status !== "playing" || ad) return;

      const video = ctx.player.video();
      if (!video) return;
      if (video !== hooked) attach();

      const now = Date.now();

      if (video.readyState === 0 && !video.paused) {
        const elapsed = now - lastGoodAt;
        if (elapsed > ctx.config.stallTimeoutMs) {
          log(`Dead playback: readyState=0, no progress for ${elapsed}ms`);
          attemptRecovery("dead-playback");
          return;
        }
      }

      if (!video.paused && video.currentTime > 0) {
        const idle = now - lastGoodAt;
        if (idle > ctx.config.stallTimeoutMs) {
          log(`Playback frozen: currentTime=${video.currentTime.toFixed(1)}, no progress for ${idle}ms`);
          attemptRecovery("frozen-playback");
          return;
        }
      }

      if (!video.paused && video.buffered.length > 0) {
        const bufferEnd = video.buffered.end(video.buffered.length - 1);
        if (bufferEnd - video.currentTime <= 0 && video.readyState < 3) {
          log(`Buffer exhausted: readyState=${video.readyState}`);
          attemptRecovery("buffer-exhausted");
        }
      }
    }, WATCHDOG_MS);

    ctx.onCleanup(() => {
      detach();
      ctx.clearTimeout(stallTimer);
      stallTimer = undefined;
      ctx.clearTimeout(recoveryTimer);
      recoveryTimer = undefined;
    });
  },
});
