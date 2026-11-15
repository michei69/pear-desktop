import { definePlugin, type LikeStatus, type NowPlaying } from "@pear/sdk";
import { isPlaying } from "@pear/sdk/util";
import { nativeTheme, type ThumbarButton } from "electron";
import { renderIcons, type Icons } from "./images.ts";

export default definePlugin({
  id: "taskbar-mediacontrol",
  name: "Taskbar media controls",
  description: "Like, dislike and playback buttons in the window's taskbar thumbnail.",
  platforms: ["win32"],
  host: {
    start(ctx) {
      const { window } = ctx;
      let icons = renderIcons();
      // What the thumbar currently shows; Win32 wants the whole list rewritten,
      // so anything unchanged must not reach setThumbarButtons or it flickers.
      let shown: { playing: boolean; like: LikeStatus; icons: Icons } | undefined;
      let hasButtons = false;

      const update = (state: NowPlaying = ctx.player.state, force = false) => {
        if (window.isDestroyed()) return;
        // Nothing to control until a track is loaded.
        if (!state.track) {
          shown = undefined;
          if (!hasButtons) return;
          hasButtons = false;
          window.setThumbarButtons([]);
          return;
        }
        const playing = isPlaying(state);
        const like = state.like;
        if (!force && shown && shown.icons === icons && shown.playing === playing && shown.like === like) return;
        shown = { playing, like, icons };
        hasButtons = true;

        const likeIcon = like === "like" ? icons.like : icons.likeHollow;
        const dislikeIcon = like === "dislike" ? icons.dislike : icons.dislikeHollow;
        const buttons: ThumbarButton[] = [
          {
            tooltip: ctx.t("plugins.taskbar-mediacontrol.dislike", "Dislike"),
            icon: dislikeIcon,
            // The page sets the rating (re-disliking clears it).
            click: () => ctx.player.control({ type: "dislike" }),
          },
          { tooltip: ctx.t("main.tray.previous", "Previous"), icon: icons.previous, click: () => ctx.player.control({ type: "previous" }) },
          {
            tooltip: playing ? ctx.t("plugins.taskbar-mediacontrol.pause", "Pause") : ctx.t("plugins.taskbar-mediacontrol.play", "Play"),
            icon: playing ? icons.pause : icons.play,
            click: () => ctx.player.control({ type: "toggle" }),
          },
          { tooltip: ctx.t("main.tray.next", "Next"), icon: icons.next, click: () => ctx.player.control({ type: "next" }) },
          {
            tooltip: ctx.t("plugins.taskbar-mediacontrol.like", "Like"),
            icon: likeIcon,
            click: () => ctx.player.control({ type: "like" }),
          },
        ];
        window.setThumbarButtons(buttons);
      };

      // One listener: `update` itself skips the unchanged renders (position
      // updates arrive every second; a rating change redraws the thumbs).
      ctx.player.on("change", (state) => update(state));
      const onTheme = () => {
        icons = renderIcons();
        update(undefined, true);
      };
      ctx.listen(nativeTheme, "updated", onTheme);
      // Windows forgets the buttons when the window is hidden.
      ctx.listen(window, "show", () => update(undefined, true));
      update();
      ctx.onCleanup(() => {
        if (!window.isDestroyed()) window.setThumbarButtons([]);
      });
    },
  },
});
