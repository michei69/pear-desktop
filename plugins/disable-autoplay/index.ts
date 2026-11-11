import { config, definePlugin } from "@pear/sdk";

export default definePlugin({
  id: "disable-autoplay",
  name: "Disable autoplay",
  description: "Starts every track paused instead of playing it automatically.",
  config: {
    applyOnce: config.bool(false, {
      label: "Only after launch",
      description: "Pause just the first track after the app starts, then play normally.",
    }),
  },
  host: {
    start(ctx) {
      // pear-desktop's menu checkbox; a flat item cannot show its state, so the
      // settings card's switch remains the canonical control.
      ctx.addMenuItem({
        label: ctx.t("plugins.disable-autoplay.menu.apply-once", "Applies only on startup"),
        click: () => ctx.setConfig({ applyOnce: !ctx.config.applyOnce }),
      });
    },
    // The menu item does not depend on the config: a toggle must not rebuild it.
    onConfigChange() {},
  },
  page: (ctx) => {
    let applied = false;
    // Set while a track is loading and the user hasn't started it yet.
    let guard = false;
    /** Pauses the track YTM just started loading; with applyOnce only the first does this. */
    const pauseLoadedTrack = () => {
      if (ctx.config.applyOnce && applied) return;
      applied = true;
      guard = true;
      ctx.player.control({ type: "pause" });
    };
    ctx.player.on("trackLoading", pauseLoadedTrack);
    // YTM starts playback after "dataloaded" (or after a pre-roll ad): stop the
    // first tick of actual track playback.
    ctx.player.on("timeUpdate", () => {
      if (!guard || ctx.player.state.status !== "playing") return;
      guard = false;
      ctx.player.control({ type: "pause" });
    });
    // A track loaded before this page part started (the plugin was enabled
    // mid-track, or a session was restored) never emits trackLoading: replay
    // pear-desktop's synthetic dataloaded here, spending the one-shot only when
    // there is a track to pause.
    if (ctx.player.state.track) pauseLoadedTrack();
    // Turning applyOnce off re-arms a spent one-shot without restarting the page
    // part (a restart would also pause the track that is playing now).
    ctx.onConfigChange((next) => {
      if (!next.applyOnce) applied = false;
    });
  },
});
