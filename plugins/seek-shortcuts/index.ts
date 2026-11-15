import { definePlugin } from "@pear/sdk";
import { isTypingTarget } from "@pear/sdk/util";

const SEEK_SECONDS = 5;

export default definePlugin({
  id: "seek-shortcuts",
  name: "Arrow key seeking",
  description: "Seeks five seconds back or forward with the left and right arrow keys.",
  page: {
    start(ctx) {
      const onKeydown = (event: KeyboardEvent) => {
        // Master installed its listener only with the player API: before that the key
        // must reach the page instead of being consumed without a seek.
        if (!ctx.player.api) return;
        if (event.defaultPrevented) return;
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.code !== "ArrowLeft" && event.code !== "ArrowRight") return;
        // A text field needs the arrows for its caret, and the open search box owns them too.
        if (isTypingTarget(event.composedPath()[0] ?? event.target)) return;
        if (ctx.$<HTMLElement & { opened?: boolean }>("nav_bar.search_box")?.opened) return;

        event.preventDefault();
        ctx.player.control({ type: "seekBy", seconds: event.code === "ArrowLeft" ? -SEEK_SECONDS : SEEK_SECONDS });
      };
      // Bubble phase, and never stop propagation: a deeper handler (the in-app menu's
      // shadow host, the lyrics picker) must get the arrows first.
      ctx.listen(window, "keydown", onKeydown);

      // Synced lyrics' view stops keys from leaving its shadow host, so after a click
      // inside the panel the window listener never sees them. Its host only stops
      // propagation: a listener on that same host still runs, after the inner handlers
      // (the provider picker marks the keys it uses as handled). YTM builds the player
      // page lazily and the view restarts with its plugin, so re-find the host.
      let listenedOn: HTMLElement | null = null;
      const attach = () => {
        // The view is stable while synced-lyrics runs: one query per player-page
        // mutation batch is enough until it goes away (its plugin restarted).
        if (listenedOn?.isConnected) return;
        const host = ctx.$<HTMLElement>("lyrics.view");
        if (!host) return;
        listenedOn = host;
        ctx.listen(host, "keydown", onKeydown);
      };
      ctx.observe("player.page", { childList: true, subtree: true }, attach);
      void ctx.waitFor("player.page").then(attach, () => {});
    },
  },
});
