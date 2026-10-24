import { config, definePlugin } from "@pear/sdk";
import { nativeImage, Tray } from "electron";

const schema = {
  includePronunciation: config.bool(false, {
    label: "Include pronunciation",
    description: "Use the romanized line when the lyrics have one.",
  }),
  maxLength: config.number(55, {
    label: "Maximum length",
    description: "Characters shown in the menu bar; 0 hides the title.",
    min: 0,
    max: 200,
    step: 1,
    unit: " chars",
  }),
};

/** Collapse whitespace and truncate to the configured length. */
const normalizeTitle = (text: string, maxLength: number) => {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const limit = Number.isFinite(maxLength) ? Math.floor(maxLength) : 0;
  if (limit <= 0) return "";
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit - 1).trimEnd()}…`;
};

// One tray per running plugin; the page sends it the current line.
let tray: Tray | undefined;

export default definePlugin({
  id: "statusbar-lyrics",
  name: "Status bar lyrics",
  description: "Shows the current synced lyric line in the macOS menu bar. Requires Synced lyrics.",
  platforms: ["darwin"],
  config: schema,
  host: {
    start(ctx) {
      const created = new Tray(nativeImage.createEmpty());
      tray = created;
      ctx.onCleanup(() => {
        if (tray === created) tray = undefined;
        if (created.isDestroyed()) return;
        created.setTitle("");
        created.destroy();
      });
      // Both options are read when a line arrives; the tray stays.
      ctx.onConfigChange(() => {});
    },
    commands: {
      setTitle(text: string) {
        if (!tray || tray.isDestroyed()) return;
        tray.setTitle(normalizeTitle(text, this.config.maxLength));
      },
    },
  },
  page: (ctx) => {
    let lastSent: string | undefined;
    let pending: string | undefined;
    let sending = false;

    /** Serialized so a slow call can't put an older line back. */
    const flush = async () => {
      if (sending) return;
      sending = true;
      try {
        while (pending !== undefined) {
          const text = pending;
          pending = undefined;
          if (text === lastSent) continue;
          await ctx.host.invoke("setTitle", text);
          lastSent = text;
        }
      } catch (error) {
        // The host may be stopping; the next update retries.
        ctx.log.warn("could not update the menu bar title", error);
      } finally {
        sending = false;
      }
    };

    const send = (text: string) => {
      if (text === pending || (text === lastSent && pending === undefined)) return;
      pending = text;
      void flush();
    };

    /** A line's text; word-synced lyrics split it into spans without separating spaces. */
    const textOf = (element: Element | null) => {
      if (!element) return "";
      const words = element.querySelectorAll(".word");
      const raw = words.length > 0 ? [...words].map((word) => word.textContent ?? "").join(" ") : (element.textContent ?? "");
      return raw.replace(/\s+/g, " ").trim();
    };

    // The rewrite's Synced lyrics view lives in a shadow root inside the tab panel.
    const activeLine = () => {
      const panel = ctx.$("lyrics.panel");
      if (!panel) return null;
      const root = panel.querySelector("pear-synced-lyrics")?.shadowRoot;
      return (
        root?.querySelector<HTMLElement>('.lines .line[data-state="active"]') ??
        panel.querySelector<HTMLElement>('.lines .line[data-state="active"]')
      );
    };

    const readText = () => {
      const line = activeLine();
      if (!line) return "";
      const romanized = line.querySelector(".romanized");
      if (ctx.config.includePronunciation && romanized) {
        const text = textOf(romanized);
        if (text) return text;
      }
      return textOf(line.querySelector(".text"));
    };

    const update = () => send(readText());

    // YTM builds the player page lazily and the lyrics view creates its shadow root
    // later, so both are found and observed again.
    const observed = new WeakSet<Node>();
    const attach = () => {
      let added = false;
      const panel = ctx.$("lyrics.panel");
      if (panel && !observed.has(panel)) {
        observed.add(panel);
        added = true;
        ctx.observe(
          panel,
          { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-state"] },
          () => {
            attach();
            update();
          },
        );
      }
      const root = panel?.querySelector("pear-synced-lyrics")?.shadowRoot;
      if (root && !observed.has(root)) {
        observed.add(root);
        added = true;
        ctx.observe(
          root,
          { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-state"] },
          update,
        );
      }
      if (added) update();
    };

    ctx.observe("lyrics.panel", { childList: true, subtree: true }, attach);
    ctx.observe("app", { childList: true, subtree: true }, attach);

    ctx.player.on("timeUpdate", update);
    ctx.player.on("statusChange", update);
    ctx.player.on("trackChange", update);
    ctx.player.on("adChange", update);

    ctx.onConfigChange(() => {
      // The same line must be sent again when the length or pronunciation option changes.
      lastSent = undefined;
      update();
    });

    attach();
    update();

    ctx.onCleanup(() => {
      lastSent = undefined;
      pending = undefined;
      void ctx.host.invoke("setTitle", "").catch(() => {});
    });
  },
});
