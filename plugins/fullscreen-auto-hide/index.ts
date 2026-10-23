import { definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };

const IDLE_MS = 2_500;
const ACTIVE_CLASS = "pear-fullscreen-active";
const IDLE_CLASS = "pear-fullscreen-idle";
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown"] as const;

export default definePlugin({
  id: "fullscreen-auto-hide",
  name: "Auto-hide in full screen",
  description: "Hides the player bar and the mouse cursor after 2.5 seconds without activity in full screen.",
  style: css`
    body.pear-fullscreen-active sel(player_bar) {
      transition: opacity 0.3s ease !important;
    }
    body.pear-fullscreen-idle {
      cursor: none;
    }
  `,
  page: {
    start(ctx) {
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      /** Whether the bar is hidden right now, so only our own overrides are removed. */
      let hidden = false;

      const clearTimer = () => {
        if (idleTimer === undefined) return;
        ctx.clearTimeout(idleTimer);
        idleTimer = undefined;
      };

      const show = () => {
        document.body.classList.remove(IDLE_CLASS);
        if (!hidden) return;
        hidden = false;
        const bar = ctx.$<HTMLElement>("player_bar");
        if (!bar) return;
        bar.style.removeProperty("opacity");
        bar.style.removeProperty("pointer-events");
      };

      const hide = () => {
        idleTimer = undefined;
        // Full screen may have ended without the layout callback running yet.
        if (!ctx.$("integrations.fullscreen")) return;
        hidden = true;
        document.body.classList.add(IDLE_CLASS);
        const bar = ctx.$<HTMLElement>("player_bar");
        if (!bar) return;
        bar.style.setProperty("opacity", "0", "important");
        bar.style.setProperty("pointer-events", "none", "important");
      };

      const schedule = () => {
        clearTimer();
        idleTimer = ctx.setTimeout(hide, IDLE_MS);
      };

      const wake = () => {
        if (!ctx.$("integrations.fullscreen")) return;
        show();
        schedule();
      };

      const apply = () => {
        if (ctx.$("integrations.fullscreen")) {
          document.body.classList.add(ACTIVE_CLASS);
          schedule();
        } else {
          document.body.classList.remove(ACTIVE_CLASS);
          clearTimer();
          show();
        }
      };

      for (const event of ACTIVITY_EVENTS) ctx.listen(document, event, wake);
      ctx.observe("app.layout", { attributes: true, attributeFilter: ["player-fullscreened"] }, apply);
      // The layout may already be fullscreen (or not exist yet) when the plugin starts.
      void ctx.waitFor("app.layout").then(apply, () => {});
      apply();

      ctx.onCleanup(() => {
        clearTimer();
        document.body.classList.remove(ACTIVE_CLASS, IDLE_CLASS);
        if (!hidden) return;
        hidden = false;
        const bar = ctx.$<HTMLElement>("player_bar");
        if (!bar) return;
        bar.style.removeProperty("opacity");
        bar.style.removeProperty("pointer-events");
      });
    },
  },
});
