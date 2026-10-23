import { definePlugin } from "@pear/sdk";

const MULTIDEVICE_RENDERER = "ytmusic-you-there-renderer";

type PaperDialog = HTMLElement & { close?: () => void };

export default definePlugin({
  id: "dismiss-multidevice-popup",
  name: "Dismiss multi-device popup",
  description: "Closes the “Are you still listening?” popup YTM shows when playback moves to another device.",
  page: {
    start(ctx) {
      const dismiss = () => {
        for (const renderer of ctx.$$("dialog.you_there")) {
          const dialog = renderer.closest<PaperDialog>("tp-yt-paper-dialog");
          if (!dialog) continue;
          if (typeof dialog.close === "function") dialog.close();
          else dialog.remove();
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
