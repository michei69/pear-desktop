import { config, definePlugin } from "@pear/sdk";

// After the equalizer, before fades and the output. The track gain follows the
// compressor, as pear-desktop's did: the loudness boost is applied to the
// compressed output instead of being compressed away by it.
const ORDER = 20;

/** YT may not have written the loudness yet when a track starts. */
const LOUDNESS_RETRY_MS = 400;
const LOUDNESS_RETRIES = 4;

interface LoudnessResponse {
  playerConfig?: {
    audioConfig?: {
      loudnessDb?: number;
      perceptualLoudnessDb?: number;
    };
  };
}

/** Boost toward the reference, never past the user's ceiling (negative loudness is quiet). */
export function trackGainDb(loudnessDb: number, ceilingDb: number) {
  const compensation = loudnessDb < 0 ? -loudnessDb : 0;
  return Math.min(compensation, Math.max(0, ceilingDb));
}

export const dbToLinear = (db: number) => 10 ** (db / 20);

export default definePlugin({
  id: "audio-compressor",
  name: "Audio compressor",
  description: "Evens out loud and quiet parts with a dynamics compressor.",
  config: {
    threshold: config.number(-50, { label: "Threshold", min: -100, max: 0, step: 1, unit: " dB" }),
    ratio: config.number(12, { label: "Ratio", min: 1, max: 20, step: 0.5, unit: ":1" }),
    knee: config.number(40, { label: "Knee", min: 0, max: 40, step: 1, unit: " dB" }),
    attack: config.number(0, { label: "Attack", min: 0, max: 1000, step: 5, unit: " ms" }),
    release: config.number(250, { label: "Release", min: 0, max: 1000, step: 5, unit: " ms" }),
    autoTrackGain: config.bool(false, {
      label: "Even out track loudness",
      description: "Boost quiet songs by the loudness YTM reports for them, after compression.",
    }),
    maxTrackGainDb: config.number(12, {
      label: "Maximum boost",
      description: "Never lift a song more than this.",
      min: 0,
      max: 24,
      step: 3,
      unit: " dB",
    }),
  },
  host: {
    start(ctx) {
      // pear-desktop's Options toggle. The menu API has no check mark, so the
      // item's label states what it does; the boost ceiling stays in settings.
      ctx.addMenuItem({
        label: ctx.t("plugins.audio-compressor.menu.auto-track-gain", "Auto track gain (boost quiet tracks)"),
        click: () => ctx.setConfig({ autoTrackGain: !ctx.config.autoTrackGain }),
      });
    },
  },
  page: async (ctx) => {
    const graph = await ctx.audio();
    const { context } = graph;
    const compressor = context.createDynamicsCompressor();
    const trackGain = context.createGain();
    trackGain.gain.value = 1;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const apply = () => {
      const { threshold, ratio, knee, attack, release } = ctx.config;
      compressor.threshold.value = threshold;
      compressor.ratio.value = ratio;
      compressor.knee.value = knee;
      compressor.attack.value = attack / 1000;
      compressor.release.value = release / 1000;
    };

    /** The loudness YTM reported for the loaded video, in dB (negative: quieter than reference). */
    const loudness = () => {
      try {
        const response = ctx.player.api?.getPlayerResponse() as LoudnessResponse | undefined;
        const audio = response?.playerConfig?.audioConfig;
        const db = audio?.loudnessDb ?? audio?.perceptualLoudnessDb;
        return typeof db === "number" && Number.isFinite(db) ? db : null;
      } catch {
        return null;
      }
    };

    const setGain = (gainDb: number) => {
      const at = context.currentTime;
      trackGain.gain.cancelScheduledValues(at);
      trackGain.gain.setValueAtTime(trackGain.gain.value, at);
      // A short ramp, so enabling or changing the ceiling doesn't click.
      trackGain.gain.linearRampToValueAtTime(dbToLinear(gainDb), at + 0.1);
    };

    const updateGain = (retriesLeft = LOUDNESS_RETRIES) => {
      ctx.clearTimeout(retry);
      retry = undefined;

      if (!ctx.config.autoTrackGain) {
        setGain(0);
        return;
      }

      const db = loudness();
      if (db === null) {
        if (retriesLeft > 0) {
          // YT fills the player response in a little after the track starts.
          retry = ctx.setTimeout(() => updateGain(retriesLeft - 1), LOUDNESS_RETRY_MS);
          return;
        }
        setGain(0);
        return;
      }

      setGain(trackGainDb(db, ctx.config.maxTrackGainDb));
    };

    apply();
    // The sub-chain's own edge; the shared graph connects the source before the
    // compressor and the track gain to what follows. One stage, so the boost is
    // applied after compression (pear-desktop's order).
    compressor.connect(trackGain);
    graph.insert(compressor, trackGain, ORDER);
    updateGain();
    void ctx.player.ready().then(
      () => updateGain(),
      () => {},
    );
    ctx.player.on("trackChange", () => updateGain());
    ctx.onConfigChange(() => {
      apply();
      updateGain();
    });

    ctx.onCleanup(() => {
      ctx.clearTimeout(retry);
      compressor.disconnect();
      trackGain.disconnect();
    });
  },
});
