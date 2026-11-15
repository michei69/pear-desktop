import { definePlugin, type HostContextOf } from "@pear/sdk";
import { audioTrackConfig } from "./config.ts";
import { startAudioTrack } from "./page.ts";

// pear-desktop's audio-track plugin: pick which audio track (language, original
// or auto-dub) a video plays, and which one to prefer on every track. The page
// part owns the tracks and the player, so the list lives there; the host only
// opens it from the app menu and the settings card.

export default definePlugin({
  id: "audio-track",
  name: "Audio track",
  description: "Picks which audio track of a video plays, and which one is preferred by default.",
  config: audioTrackConfig,
  actions: {
    selectTrack: {
      label: "Choose audio track…",
      description: "Pick the track for the current video, or Automatic.",
    },
  },
  host: {
    start(ctx) {
      ctx.addMenuItem({
        label: ctx.t("plugins.audio-track.menu.label", "Audio track…"),
        click: () => {
          // A closed or reloading player must become a log line, not an unhandled rejection.
          openPicker(ctx).catch((error: unknown) => ctx.log.warn("couldn't open the audio track picker", error));
        },
      });
      // pear-desktop's quick toggle; a flat menu item cannot show the state, the
      // settings card's switch is the canonical control.
      ctx.addMenuItem({
        label: ctx.t("plugins.audio-track.menu.prefer-original", "Prefer the original audio"),
        click: () => ctx.setConfig({ preferOriginal: !ctx.config.preferOriginal }),
      });
    },
    commands: {
      /** The settings card's button. */
      selectTrack() {
        return openPicker(this);
      },
    },
    // The menu items do not depend on the config: a pick must not rebuild them.
    onConfigChange() {},
  },
  page: {
    start(ctx) {
      return startAudioTrack(ctx);
    },
    onConfigChange() {},
  },
});

/** Asks the page to show its track list; the settings card surfaces a failure. */
async function openPicker(ctx: HostContextOf<typeof audioTrackConfig>) {
  // The list is in the player page: look at it when the pick comes from settings.
  ctx.focusWindow();
  await ctx.request("open", undefined, { timeout: 3000 });
}
