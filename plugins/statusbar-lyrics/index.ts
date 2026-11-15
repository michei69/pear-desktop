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

/** The line synced-lyrics' view pushes while it runs. */
const ACTIVE_LINE_EVENT = "pear:synced-lyrics-line";

interface ActiveLyricLine {
  text: string;
  romanized: string | null;
}

const collapseWhitespace = (text: string) => text.replace(/\s+/g, " ").trim();

/** Collapse whitespace and truncate to the configured length. */
const normalizeTitle = (text: string, maxLength: number) => {
  const cleaned = collapseWhitespace(text);
  const limit = Number.isFinite(maxLength) ? Math.floor(maxLength) : 0;
  if (limit <= 0) return "";
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit - 1).trimEnd()}…`;
};

/** The next of master's presets after `maxLength`, wrapping at the end. */
const nextMaxLength = (maxLength: number) => MAX_LENGTH_CHOICES.find((length) => length > maxLength) ?? MAX_LENGTH_CHOICES[0]!;

function isActiveLine(value: unknown): value is ActiveLyricLine {
  if (!value || typeof value !== "object") return false;
  const line = value as Partial<ActiveLyricLine>;
  return typeof line.text === "string" && (line.romanized === null || typeof line.romanized === "string");
}

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

      let line: ActiveLyricLine | null = null;

      /** The menu-bar title for the current line, with the options applied here. */
      const apply = () => {
        const text = line ? (ctx.config.includePronunciation ? line.romanized || line.text : line.text) : "";
        const title = normalizeTitle(text, ctx.config.maxLength);
        // A cleared title before the first line must not reserve a status item.
        if (!title && !tray) return;
        const instance = getTray();
        if (instance.isDestroyed()) return;
        instance.setTitle(title);
      };

      // Synced lyrics owns the view and its timing; this plugin only draws the
      // line it reports, so it does not read another plugin's shadow DOM.
      ctx.listen(ctx.app, ACTIVE_LINE_EVENT, (payload: unknown) => {
        line = isActiveLine(payload) ? payload : null;
        apply();
      });
      // The length and pronunciation settings apply to the line already shown.
      ctx.onConfigChange(apply);
      ctx.onCleanup(() => {
        const created = tray;
        tray = undefined;
        if (!created || created.isDestroyed()) return;
        created.setTitle("");
        created.destroy();
      });
    },
  },
});
