import { dialog } from "electron";
import { definePlugin, type HostContextOf } from "@pear/sdk";
import { audioTrackConfig } from "./config.ts";
import { startAudioTrack } from "./page.ts";

// pear-desktop's audio-track plugin: pick which audio track (language, original
// or auto-dub) a video plays, and which one to prefer on every track. The
// picker is a native dialog in the host part; the page part owns the tracks and
// the player, so it lists them and applies the choice.

export default definePlugin({
  id: "audio-track",
  name: "Audio track",
  description: "Picks which audio track of a video plays, and which one is preferred by default.",
  config: audioTrackConfig,
  host: {
    start(ctx) {
      ctx.addMenuItem({
        label: ctx.t("plugins.audio-track.menu.label", "Audio track…"),
        click: () => void chooseTrack(ctx),
      });
    },
  },
  page: {
    async start(ctx) {
      return startAudioTrack(ctx);
    },
    onConfigChange() {},
  },
});

/** Shows the video's tracks and hands the choice back to the page part. */
async function chooseTrack(ctx: HostContextOf<typeof audioTrackConfig>) {
  const choices = await ctx
    .request<{ labels: string[]; current: number }>("tracks", undefined, { timeout: 3000 })
    .catch(() => null);
  if (!choices) return;

  if (choices.labels.length < 2) {
    ctx.emit("no-tracks");
    return;
  }

  const buttons = [ctx.t("plugins.audio-track.menu.automatic", "Automatic"), ...choices.labels];
  const cancelId = buttons.length;
  buttons.push(ctx.t("plugins.audio-track.menu.cancel", "Cancel"));

  const { response } = await dialog.showMessageBox(ctx.window, {
    type: "question",
    title: ctx.t("plugins.audio-track.menu.label", "Audio track…"),
    message: ctx.t("plugins.audio-track.menu.message", "Which audio track should play?"),
    buttons,
    defaultId: Math.min(choices.current + 1, cancelId - 1),
    cancelId,
    noLink: true,
  });
  if (response === cancelId) return;
  ctx.emit("apply", response);
}
