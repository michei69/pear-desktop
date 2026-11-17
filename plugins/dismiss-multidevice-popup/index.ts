import { definePlugin } from "@pear/sdk";
import { isPlaying } from "@pear/sdk/util";
import { canHandle, shouldResume } from "./gate.ts";

const MULTIDEVICE_RENDERER = "ytmusic-you-there-renderer";

type PaperDialog = HTMLElement & { close?: () => void };

export default definePlugin({
  id: "dismiss-multidevice-popup",
  name: "Dismiss multi-device popup",
  description: "Closes the “Are you still listening?” popup YTM shows when playback moves to another device.",
  page: {
    start(ctx) {
      /** Handled dialogs, so a re-render of the same prompt is not handled twice. */
      const handled = new WeakSet<Element>();
      // Only handle the prompt shortly after playback was active, and at most once per cooldown.
      let lastActivityAt = isPlaying(ctx.player.state) ? Date.now() : 0;
      /** When playback last paused: only the prompt's own pause may be resumed. */
      let pausedAt = ctx.player.state.status === "paused" ? Date.now() : 0;
      let lastHandledAt = 0;
      ctx.player.on("timeUpdate", () => {
        lastActivityAt = Date.now();
      });
      ctx.player.on("statusChange", (status) => {
        if (status === "paused") pausedAt = Date.now();
        else pausedAt = 0;
        if (status === "playing") lastActivityAt = Date.now();
      });

      const dismiss = () => {
        const now = Date.now();
        if (!canHandle(now, lastActivityAt, lastHandledAt)) return;
        for (const renderer of ctx.$$("dialog.you_there")) {
          const dialog = renderer.closest<PaperDialog>("tp-yt-paper-dialog");
          if (!dialog || handled.has(dialog)) continue;
          handled.add(dialog);
          lastHandledAt = Date.now();
          // Click a confirmation button rather than a bare close: that dismisses the prompt.
          const confirm = dialog.querySelector<HTMLElement>("[dialog-confirm], yt-button-renderer, tp-yt-paper-button, button");
          if (confirm) confirm.click();
          else if (typeof dialog.close === "function") dialog.close();
          else dialog.remove();
          // The prompt paused the queue when it appeared; resume only that pause,
          // never a pause the user made earlier (e.g. through disable-autoplay).
          if (ctx.player.state.status === "paused" && shouldResume(now, pausedAt)) ctx.player.control({ type: "play" });
        }
      };

      dismiss();

      ctx.observe(document.body, { childList: true, subtree: true }, (mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node instanceof Element && (node.matches(MULTIDEVICE_RENDERER) || node.querySelector(MULTIDEVICE_RENDERER))) {
              dismiss();
              return;
            }
          }
        }
      });
    },
  },
});
