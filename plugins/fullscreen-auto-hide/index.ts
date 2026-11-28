import { definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };

const IDLE_MS = 2_500;
const ACTIVE_CLASS = "pear-fullscreen-active";
const IDLE_CLASS = "pear-fullscreen-idle";
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown"] as const;

/** Every signal YTM fires when its player enters or leaves full screen. */
const FULLSCREEN_EVENTS = ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"] as const;
/** YTM's own fullscreen event can fire before its DOM state settles. */
const RECHECK_MS = 100;
/** mousemove arrives far faster than the bar needs to react. */
const WAKE_THROTTLE_MS = 100;

/** The native fullscreen API as the older prefixes expose it. */
type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
};

export default definePlugin({
  id: "fullscreen-auto-hide",
  name: "Auto-hide in full screen",
  description: "Hides the player bar and the mouse cursor after 2.5 seconds without activity in full screen.",
  style: css`
    /* For the plugin's lifetime, so leaving full screen fades the bar back in. */
    sel(player_bar) {
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

      // Another plugin may have inline opacity/pointer-events on the bar: put
      // those back instead of removing whatever is there when we show it.
      let saved: { element: HTMLElement; opacity: [string, string]; pointer: [string, string] } | undefined;

      const show = () => {
        document.body.classList.remove(IDLE_CLASS);
        if (!hidden) return;
        hidden = false;
        if (!saved) return;
        for (const [property, [value, priority]] of [
          ["opacity", saved.opacity],
          ["pointer-events", saved.pointer],
        ] as const) {
          if (value) saved.element.style.setProperty(property, value, priority);
          else saved.element.style.removeProperty(property);
        }
        saved = undefined;
      };

      const hide = () => {
        idleTimer = undefined;
        // Full screen may have ended without the layout callback running yet.
        if (!isFullscreen()) return;
        hidden = true;
        document.body.classList.add(IDLE_CLASS);
        const bar = ctx.$<HTMLElement>("player_bar");
        if (!bar) return;
        saved ??= {
          element: bar,
          opacity: [bar.style.getPropertyValue?.("opacity") ?? "", bar.style.getPropertyPriority?.("opacity") ?? ""],
          pointer: [bar.style.getPropertyValue?.("pointer-events") ?? "", bar.style.getPropertyPriority?.("pointer-events") ?? ""],
        };
        bar.style.setProperty("opacity", "0", "important");
        bar.style.setProperty("pointer-events", "none", "important");
      };

      const schedule = () => {
        clearTimer();
        idleTimer = ctx.setTimeout(hide, IDLE_MS);
      };

      // mousemove fires hundreds of times a second; a DOM query and timer reset
      // per event is wasted work. Once per animation-frame-ish window is plenty.
      let lastWake = 0;
      const wake = () => {
        const now = Date.now();
        if (now - lastWake < WAKE_THROTTLE_MS) return;
        lastWake = now;
        if (!isFullscreen()) return;
        show();
        schedule();
      };

      /**
       * The player is in full screen when YTM says so on the layout or on the bar,
       * or when the browser itself is in the native fullscreen API: entering from
       * the player's own button and from `requestFullscreen` fire different signals.
       */
      const isFullscreen = () => {
        if (ctx.$("integrations.fullscreen")) return true;
        if (ctx.$("player_bar")?.hasAttribute("player-fullscreened")) return true;
        const doc = document as FullscreenDocument;
        return (
          document.fullscreenElement != null ||
          doc.webkitFullscreenElement != null ||
          doc.mozFullScreenElement != null ||
          doc.msFullscreenElement != null
        );
      };

      const apply = () => {
        if (isFullscreen()) {
          document.body.classList.add(ACTIVE_CLASS);
          schedule();
        } else {
          document.body.classList.remove(ACTIVE_CLASS);
          clearTimer();
          show();
        }
      };

      /** YTM fires a burst of fullscreen signals: re-read the settled state once. */
      let recheck: ReturnType<typeof setTimeout> | undefined;
      const recheckFullscreen = () => {
        if (recheck !== undefined) ctx.clearTimeout(recheck);
        recheck = ctx.setTimeout(() => {
          recheck = undefined;
          apply();
        }, RECHECK_MS);
      };

      for (const event of ACTIVITY_EVENTS) ctx.listen(document, event, wake);
      for (const event of FULLSCREEN_EVENTS) ctx.listen(document, event, apply);
      ctx.listen(document, "ytm-player-fullscreen", recheckFullscreen);
      ctx.observe("app.layout", { attributes: true, attributeFilter: ["player-fullscreened"] }, apply);
      ctx.observe("player_bar", { attributes: true, attributeFilter: ["player-fullscreened"] }, apply);
      // The layout may already be fullscreen (or not exist yet) when the plugin starts.
      void ctx.waitFor("app.layout").then(apply, () => {});
      apply();

      ctx.onCleanup(() => {
        clearTimer();
        if (recheck !== undefined) ctx.clearTimeout(recheck);
        document.body.classList.remove(ACTIVE_CLASS, IDLE_CLASS);
        show();
      });
    },
  },
});
