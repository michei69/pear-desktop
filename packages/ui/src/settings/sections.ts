// The dialog's sections and what each one shows.

import type { CoreSection } from "@pear/sdk/core-config";
import { CONTEXT_MENU_ENTRIES } from "@pear/sdk/context-menu";
import type { IconName } from "../icons.tsx";
import type { Text, UiKey } from "../strings.ts";

export type Block =
  /** A core settings section, one card per field group. */
  | { kind: "core"; section: CoreSection; title?: UiKey; exclude?: readonly string[]; prefix?: boolean }
  /** Some of a core section's fields, for options that belong elsewhere (the update settings in About). */
  | { kind: "core-keys"; section: CoreSection; keys: readonly string[]; title?: UiKey }
  /** A plugin's card, embedded where it belongs thematically. */
  | { kind: "plugin"; id: string; title: UiKey }
  /** The folder themes: selection, presets, palette, import. */
  | { kind: "themes" }
  /** The update options, under About's action buttons like pear-desktop's. */
  | { kind: "updates" }
  /** The developer actions (devtools, edit config). */
  | { kind: "configuration" };

export type SectionId = "general" | "appearance" | "window" | "performance" | "plugins" | "advanced" | "flags" | "about";

export interface Section {
  id: SectionId;
  icon: IconName;
  /** What the section shows; "plugins", "flags" and "about" have views of their own. */
  blocks: Block[];
}

/** The context-menu switches, kept together after the theme card. */
const CONTEXT_MENU_KEYS = CONTEXT_MENU_ENTRIES.map((entry) => entry.configKey);
/** The Window & Tray tab's own cards; the tray and title bar cards sit between them. */
const WINDOW_KEYS = ["alwaysOnTop", "hideMenu", "customWindowTitle"];
const SYSTEM_KEYS = ["startAtLogin", "forceSmtc", "appVisible"];

/** In the sidebar's order. */
export const SECTIONS: Record<SectionId, Section> = {
  general: {
    id: "general",
    icon: "settings",
    // The update settings live in About, like pear-desktop's.
    blocks: [{ kind: "core", section: "general", exclude: ["autoUpdates", "updateChannel"] }],
  },
  appearance: {
    id: "appearance",
    icon: "palette",
    blocks: [
      { kind: "core", section: "appearance", exclude: CONTEXT_MENU_KEYS },
      { kind: "themes" },
      { kind: "core-keys", section: "appearance", keys: CONTEXT_MENU_KEYS },
    ],
  },
  window: {
    id: "window",
    icon: "window",
    blocks: [
      { kind: "core-keys", section: "window", keys: WINDOW_KEYS },
      { kind: "plugin", id: "tray", title: "settings-ui.blocks.tray" },
      { kind: "plugin", id: "in-app-menu", title: "settings-ui.blocks.title-bar" },
      { kind: "core", section: "settingsUi", title: "settings-ui.blocks.settings-menu" },
      { kind: "core-keys", section: "window", keys: SYSTEM_KEYS },
    ],
  },
  performance: {
    id: "performance",
    icon: "speed",
    blocks: [
      { kind: "core", section: "performance" },
      { kind: "core-keys", section: "advanced", keys: ["disableHardwareAcceleration", "autoResetAppCache"] },
    ],
  },
  advanced: {
    id: "advanced",
    icon: "tune",
    blocks: [
      // The restart-on-change switch belongs with the Configuration actions below.
      { kind: "core", section: "advanced", exclude: ["restartOnConfigChanges", "disableHardwareAcceleration", "autoResetAppCache"] },
      { kind: "core", section: "apiServer", title: "settings-ui.blocks.api-server", prefix: true },
      { kind: "configuration" },
    ],
  },
  plugins: { id: "plugins", icon: "puzzle", blocks: [] },
  flags: { id: "flags", icon: "flag", blocks: [] },
  about: { id: "about", icon: "info", blocks: [{ kind: "updates" }] },
};

/** The sections in the sidebar (SECTIONS is keyed by id, not ordered for display). */
export const SECTION_ORDER: readonly SectionId[] = [
  "general",
  "appearance",
  "window",
  "performance",
  "plugins",
  "advanced",
  "flags",
  "about",
];

export const sectionLabel = (text: Text, id: SectionId) => text(`settings-ui.sections.${id}.label`);

/** A core section's title where it is not a sidebar section of its own (search results); the site section has no card. */
export const coreSectionLabel = (text: Text, section: Exclude<CoreSection, "site">): string => {
  if (section === "apiServer") return text("settings-ui.blocks.api-server");
  if (section === "settingsUi") return text("settings-ui.blocks.settings-menu");
  return sectionLabel(text, section);
};

/** "Label · Sub-label", leaving out the missing parts; undefined when both are. */
export function joinTitles(...titles: (string | undefined)[]) {
  return titles.filter(Boolean).join(" · ") || undefined;
}
