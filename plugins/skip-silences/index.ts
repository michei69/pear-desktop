import { config, definePlugin } from "@pear/sdk";
import { afterSeek, createLatch, FIRST_BIN, INTERVAL_MS, resetLatch, sample, shouldSkip, THRESHOLD_DB } from "./latch.ts";

const SKIP_SECONDS = 0.2;
const FFT_SIZE = 512;
const SMOOTHING = 0.1;
// First in the shared graph, so the analysis sees the track before any fades or effects.
const ORDER = -100;

export default definePlugin({
  id: "skip-silences",
  name: "Skip silences",
  description: "Skips over silent parts of tracks.",
  config: {
    onlySkipBeginning: config.bool(false, { label: "Only skip silence at the start of a track" }),
  },
  page: {
    async start(ctx) {
      const graph = await ctx.audio();
      const { context } = graph;
      // YTM may replace the <video>; keep the reference and the listeners on the live one.
      let video = graph.video;
      // `input` feeds both the chain (through `output`) and the analyser; the
      // graph only rewires the stage's output, so the analyser stays connected.
      const input = context.createGain();
      const output = context.createGain();
      const analyser = context.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = SMOOTHING;
      input.connect(output);
      input.connect(analyser);
      graph.insert(input, output, ORDER);

      const bins = new Float32Array(analyser.frequencyBinCount);
      const latch = createLatch();

      const loudness = () => {
        analyser.getFloatFrequencyData(bins);
        let max = Number.NEGATIVE_INFINITY;
        for (const bin of bins.subarray(FIRST_BIN)) {
          if (bin > max && bin < 0) max = bin;
        }
        return max;
      };
      const skip = () => {
        const onlySkipBeginning = ctx.config.onlySkipBeginning;
        if (shouldSkip(latch, { onlySkipBeginning, paused: video.paused, ad: ctx.player.state.ad })) {
          video.currentTime += SKIP_SECONDS;
        }
      };

      // The loop exists only while playing, as in pear-desktop: a paused player
      // has nothing to sample, and a timer for the plugin's whole lifetime keeps
      // the page waking for nothing. `ctx.setInterval` is cleared on stop, too.
      let timer: ReturnType<typeof setInterval> | undefined;
      const stopLoop = () => {
        if (timer === undefined) return;
        ctx.clearInterval(timer);
        timer = undefined;
      };
      const tick = () => {
        // A pause may arrive between two ticks (or a seek while paused); the
        // event handler stops the loop, but never sample a paused element.
        if (video.paused) {
          stopLoop();
          return;
        }
        if (ctx.player.state.ad) return;
        const loud = loudness() > THRESHOLD_DB;
        const muted = video.seeking || video.ended || video.muted || video.volume === 0;
        if (sample(latch, { loud, muted })) skip();
      };
      const startLoop = () => {
        timer ??= ctx.setInterval(tick, INTERVAL_MS);
      };

      // Each seek (including our own skips) re-checks, so a long silence is crossed in steps.
      const onPlayOrSeek = () => {
        // A seek does not restart the track: `audioStarted` ("real audio heard
        // since the track began") must survive it, or any seek, including the
        // one skip() makes itself, re-arms beginning-only skipping mid-track.
        // Only the samples from before the jump stop counting.
        afterSeek(latch);
        skip();
        // Seeking a paused player must not start the loop.
        if (video.paused) stopLoop();
        else startLoop();
      };
      const onPauseOrEnded = () => stopLoop();
      let unbindVideo: (() => void)[] = [];
      const bindVideo = () => {
        for (const off of unbindVideo) off();
        const target = video;
        const listen = (type: string, listener: EventListener) => {
          target.addEventListener(type, listener);
          return () => target.removeEventListener(type, listener);
        };
        unbindVideo = [
          listen("play", onPlayOrSeek),
          listen("seeked", onPlayOrSeek),
          listen("pause", onPauseOrEnded),
          listen("ended", onPauseOrEnded),
        ];
        if (video.paused) stopLoop();
        else startLoop();
      };
      bindVideo();
      ctx.player.on("videoChange", (next) => {
        video = next;
        bindVideo();
      });
      ctx.onCleanup(() => {
        for (const off of unbindVideo) off();
      });
      // A new track re-arms beginning-only skipping: the latch is per track, and
      // only the tracker's own skips had to survive. `trackLoading` rather than
      // `trackChange`: the latter can arrive up to a second and a half into the
      // new track (the runtime's dataupdated fallback), after its audio was heard,
      // and resetting then would un-arm the setting mid-track.
      ctx.player.on("trackLoading", () => {
        resetLatch(latch);
        // Gapless autoplay may never fire `play` again; keep sampling if it plays.
        if (video.paused) stopLoop();
        else startLoop();
      });

      // Do not sample while the media is already paused (plugin enabled mid-session).
      if (!video.paused) startLoop();

      return () => input.disconnect();
    },
    onConfigChange() {},
  },
});
