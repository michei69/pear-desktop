import { definePlugin } from "@pear/sdk";
import { EqualizerChain } from "./audio.ts";
import {
  encodeBands,
  MAX_RECENT_PRESETS,
  migrationPatch,
  presetProfile,
  profilesMatch,
  readConfig,
  schema,
  type EqualizerConfig,
} from "./config.ts";
import { createEqualizerPanel } from "./panel.tsx";

export default definePlugin({
  id: "equalizer",
  name: "Equalizer",
  description: "An 11-band equalizer with an interactive curve, presets and pear-desktop's extra filters.",
  config: schema,
  actions: {
    open: {
      label: "Open equalizer",
      description: "Edit the curve and bands, and manage presets.",
    },
  },
  host: {
    commands: {
      open() {
        this.focusWindow();
        this.emit("open");
      },
    },
  },
  page: async (ctx) => {
    // Register before the migration write: a config change without a listener
    // restarts the page part.
    let chain: EqualizerChain | undefined;
    let lastPreset = ctx.config.preset;
    let lastBands = ctx.config.bands;
    const apply = () => {
      const config = ctx.config;
      const state = readConfig(config);
      // The previous rewrite treated a changed `preset` as "move the bands to
      // it". The panel writes matching bands and output together, so this only
      // fills in an inconsistent preset patch (and never fights a band edit).
      if (config.preset !== lastPreset && config.preset !== "custom") {
        const profile = presetProfile(config.preset, state.userPresets);
        if (profile && !profilesMatch(state, profile)) {
          const bands = encodeBands(profile.bands);
          lastPreset = config.preset;
          lastBands = bands;
          const patch: Partial<EqualizerConfig> = {
            bands,
            preset: config.preset,
            recentPresets: [config.preset, ...state.recentPresets.filter((id) => id !== config.preset)].slice(0, MAX_RECENT_PRESETS),
          };
          const outputGainDb = profile.outputGainDb;
          if (outputGainDb !== undefined) patch.outputGainDb = outputGainDb;
          ctx.setConfig(patch);
          chain?.apply(readConfig(ctx.config), ctx.config.filters, ctx.log);
          return;
        }
      }
      // As before, moving a band away from the active preset makes it Custom.
      if (config.bands !== lastBands && config.preset !== "custom" && state.activePreset === "custom") {
        lastPreset = "custom";
        lastBands = config.bands;
        ctx.setConfig({ preset: "custom" });
        chain?.apply(state, config.filters, ctx.log);
        return;
      }
      lastPreset = config.preset;
      lastBands = config.bands;
      chain?.apply(state, config.filters, ctx.log);
    };
    ctx.onConfigChange(apply);
    // The previous rewrite's preamp/bands are read once, then stored under the
    // new keys so later config changes never re-apply them.
    const patch = migrationPatch(ctx.config);
    if (patch) ctx.setConfig(patch);
    lastPreset = ctx.config.preset;
    lastBands = ctx.config.bands;

    // Available even while the player is still loading.
    const panel = createEqualizerPanel(ctx);
    ctx.host.on("open", () => panel.open());

    const graph = await ctx.audio();
    if (ctx.signal.aborted) return;
    chain = new EqualizerChain(graph);
    apply();

    // YTM replaces the <video> element on some seeks; follow it into our stage.
    const watchVideo = () => {
      const video = ctx.player.video();
      if (video) chain?.rebind(video);
    };
    ctx.observe("player.api", { childList: true, subtree: true }, watchVideo);
    ctx.player.on("trackChange", () => watchVideo());
    watchVideo();

    ctx.onCleanup(() => chain?.dispose());
  },
});
