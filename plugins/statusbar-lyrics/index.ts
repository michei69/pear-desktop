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

/** Master's one-click title lengths. */
const MAX_LENGTH_CHOICES = [30, 40, 55, 70, 85, 100, 120];

/** Collapse whitespace and truncate to the configured length. */
const normalizeTitle = (text: string, maxLength: number) => {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const limit = Number.isFinite(maxLength) ? Math.floor(maxLength) : 0;
  if (limit <= 0) return "";
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit - 1).trimEnd()}…`;
};

/** The next of master's presets after `maxLength`, wrapping at the end. */
const nextMaxLength = (maxLength: number) => MAX_LENGTH_CHOICES.find((length) => length > maxLength) ?? MAX_LENGTH_CHOICES[0]!;

/** How soon a rejected title update is retried; master's send heartbeat interval. */
const RETRY_MS = 250;

// One tray per running plugin, created with the first line: with nothing
// playing, no empty status item is reserved for the whole session.
let tray: Tray | undefined;

const getTray = () => (tray ??= new Tray(nativeImage.createEmpty()));

export default definePlugin({
  id: "statusbar-lyrics",
  name: "Status bar lyrics",
  description: "Shows the current synced lyric line in the macOS menu bar. Requires Synced lyrics.",
  platforms: ["darwin"],
  config: schema,
  host: {
    start(ctx) {
      // Master's title-length presets and the pronunciation switch as menu
      // items: PluginMenuItem has no checked/radio state, so the length item
      // cycles and the settings card keeps the slider.
      ctx.addMenuItem({
        label: ctx.t("plugins.statusbar-lyrics.menu.max-length", "Maximum length"),
        click: () => ctx.setConfig({ maxLength: nextMaxLength(ctx.config.maxLength) }),
      });
      ctx.addMenuItem({
        label: ctx.t("plugins.statusbar-lyrics.settings.includePronunciation.label", "Include pronunciation"),
        click: () => ctx.setConfig({ includePronunciation: !ctx.config.includePronunciation }),
      });
      // Both options are read when a line arrives; the tray stays.
      ctx.onConfigChange(() => {});
      ctx.onCleanup(() => {
        const created = tray;
        tray = undefined;
        if (!created || created.isDestroyed()) return;
        created.setTitle("");
        created.destroy();
      });
    },
    commands: {
      setTitle(text: string) {
        const title = normalizeTitle(text, this.config.maxLength);
        // A cleared title before the first line must not reserve a status item.
        if (!title && !tray) return;
        const instance = getTray();
        if (instance.isDestroyed()) return;
        instance.setTitle(title);
      },
    },
  },
  page: (ctx) => {
    let lastSent: string | undefined;
    let pending: string | undefined;
    let sending = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    /** Serialized so a slow call can't put an older line back. */
    const flush = async () => {
      if (sending) return;
      sending = true;
      ctx.clearTimeout(retry);
      retry = undefined;
      try {
        while (pending !== undefined) {
          const text = pending;
          pending = undefined;
          if (text === lastSent) continue;
          try {
            await ctx.host.invoke("setTitle", text);
          } catch (error) {
            // The host may be stopping. Keep the line uncommitted and retry
            // shortly: while paused, no player event would retry it sooner.
            ctx.log.warn("could not update the menu bar title", error);
            // A newer line arrived meanwhile: send that instead of this one.
            if (pending !== undefined) continue;
            pending = text;
            retry = ctx.setTimeout(() => {
              retry = undefined;
              void flush();
            }, RETRY_MS);
            break;
          }
          lastSent = text;
        }
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
      ctx.clearTimeout(retry);
      retry = undefined;
      void ctx.host.invoke("setTitle", "").catch(() => {});
    });
  },
});
