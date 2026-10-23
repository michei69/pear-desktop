import { definePlugin } from "@pear/sdk";

const AUTO_CLOSE_MS = 3_000;

type Toast = HTMLElement & { close?: () => void };

export default definePlugin({
  id: "toast-autoclose",
  name: "Close toasts after three seconds",
  description: "Closes YTM's notifications in the bottom left after three seconds.",
  enabledByDefault: true,
  page: {
    start(ctx) {
      const root = ctx.$<HTMLElement>("app") ?? document.body;
      const timers = new Map<Toast, ReturnType<typeof setTimeout>>();
      /** Toasts already told to close, until they close or leave the page. */
      const fired = new WeakSet<Toast>();
      let frame: number | undefined;

      const stopTimer = (toast: Toast) => {
        const timer = timers.get(toast);
        if (timer !== undefined) ctx.clearTimeout(timer);
        timers.delete(toast);
      };

      const forget = (node: Element) => {
        if (!(node instanceof HTMLElement)) return;
        if (node.localName === "tp-yt-paper-toast") {
          stopTimer(node as Toast);
          fired.delete(node as Toast);
        }
        for (const toast of node.querySelectorAll<Toast>("tp-yt-paper-toast")) {
          stopTimer(toast);
          fired.delete(toast);
        }
      };

      const closeToast = (toast: Toast) => {
        timers.delete(toast);
        if (!toast.isConnected || !toast.classList.contains("paper-toast-open")) return;
        if (fired.has(toast)) return;
        fired.add(toast);

        const closeButton = toast.querySelector<HTMLElement>("#close-button button");
        if (closeButton) closeButton.click();
        else toast.close?.();
      };

      const arm = (toast: Toast) => {
        if (timers.has(toast) || fired.has(toast)) return;
        if (!toast.classList.contains("paper-toast-open")) return;
        timers.set(
          toast,
          ctx.setTimeout(() => closeToast(toast), AUTO_CLOSE_MS),
        );
      };

      const scan = () => {
        for (const toast of [...timers.keys()]) {
          if (!toast.isConnected || !toast.classList.contains("paper-toast-open")) {
            stopTimer(toast);
            fired.delete(toast);
          }
        }
        for (const toast of ctx.$$<Toast>("toast", root)) arm(toast);
      };

      // One scan per batch of DOM changes, however many mutations it took.
      const schedule = () => {
        if (frame !== undefined) return;
        frame = requestAnimationFrame(() => {
          frame = undefined;
          scan();
        });
      };

      const isToastRelated = (node: Node) => {
        if (!(node instanceof Element)) return false;
        if (node.localName === "tp-yt-paper-toast") return true;
        return node.closest("tp-yt-paper-toast") !== null || node.querySelector("tp-yt-paper-toast") !== null;
      };

      scan();
      ctx.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] }, (mutations) => {
        let relevant = false;
        for (const mutation of mutations) {
          // A class change on a toast that is no longer open: it can be armed again next time.
          if (
            mutation.type === "attributes" &&
            mutation.target instanceof Element &&
            mutation.target.localName === "tp-yt-paper-toast" &&
            !mutation.target.classList.contains("paper-toast-open")
          ) {
            forget(mutation.target);
          }
          for (const node of mutation.removedNodes) if (node instanceof Element) forget(node);
          if (!relevant && (isToastRelated(mutation.target) || [...mutation.addedNodes].some(isToastRelated))) relevant = true;
        }
        if (relevant) schedule();
      });

      ctx.onCleanup(() => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        for (const timer of timers.values()) ctx.clearTimeout(timer);
        timers.clear();
      });
    },
  },
});
