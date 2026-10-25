// The settings dialog's own texts: English defaults by translation key (the
// keys pear-desktop's settings UI used). `nub run i18n` copies them into en.json.

import type { Field } from "@pear/sdk";
import { fieldKey, groupKey, type Translate, type Vars } from "@pear/sdk/i18n";
import { createContext } from "preact";
import { useContext } from "preact/hooks";

export const UI_STRINGS = {
  "settings-ui.title": "Settings",
  "settings-ui.search-placeholder": "Search settings",
  "settings-ui.sections-label": "Settings sections",
  "settings-ui.search-results": "Search results",
  "settings-ui.search-matching": "Matching “{{query}}”",
  "settings-ui.no-match": "No settings match “{{query}}”.",
  "settings-ui.close": "Close settings",
  "settings-ui.show-config": "Show config.json",
  "settings-ui.edit-config": "Edit config.json",
  "settings-ui.restart-banner": "Some changes need a restart to take effect.",
  "settings-ui.later": "Later",
  "settings-ui.restart-now": "Restart now",
  "settings-ui.restart-pill": "restart",
  "settings-ui.restart-pill-hint": "Applies after a restart",
  "settings-ui.restart-plugin-hint": "Enabling or disabling applies after a restart",
  "settings-ui.error-pill": "error",
  "settings-ui.configure": "Configure {{name}}",
  "settings-ui.enable": "Enable {{name}}",
  "settings-ui.add": "Add",
  "settings-ui.remove": "Remove {{item}}",
  "settings-ui.entry": "entry {{number}}",
  "settings-ui.decrease": "Decrease {{label}}",
  "settings-ui.increase": "Increase {{label}}",
  "settings-ui.language-sync.label": "Sync language",
  "settings-ui.language-sync.from": "From YT",
  "settings-ui.language-sync.to": "To YT",
  "settings-ui.shortcut-recording": "Press keys…",
  "settings-ui.shortcut-unset": "Not set",
  "settings-ui.shortcut-hint": "Click, then press a key combination. Backspace clears, Escape cancels.",
  "settings-ui.open": "Pear Desktop settings",
  "settings-ui.open-hint": "Pear Desktop settings (Ctrl+,)",
  "settings-ui.api-server-status": "Listening on {{address}} · API docs at {{address}}/swagger",
  "settings-ui.blocks.tray": "Tray",
  "settings-ui.blocks.title-bar": "Title bar",
  "settings-ui.blocks.api-server": "API server",
  "settings-ui.blocks.site-features": "Site features",
  "settings-ui.blocks.updates": "Updates",
  "settings-ui.blocks.configuration": "Configuration",
  "settings-ui.toggle-devtools": "Toggle developer tools",
  "main.menu.options.submenu.visual-tweaks.submenu.theme.label": "Theme",
  "main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.no-theme": "No theme",
  "main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.presets.default": "Default",
  "main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.presets.custom": "Custom",
  "main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.colors.label": "Colors",
  "main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.reset-colors": "Reset colors",
  "main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.import-css-file": "Import custom CSS file",
  "main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.open-themes-folder": "Open themes folder",
  "settings-ui.fields.theme-preset": "Preset",
  "settings-ui.fields.theme-variable-name": "Variable",
  "settings-ui.fields.theme-variable-value": "Value",
  "settings-ui.fields.theme-variable-add": "Add variable",
  "settings-ui.themes.description":
    "Themes are folders in the themes directory, each with a theme.json manifest. Pick one here or under Options › Theme.",
  "settings-ui.themes.empty": "No theme folders yet. Create one in the themes folder, or import a CSS file.",
  "settings-ui.themes.js-blocked": "This theme's script is blocked until you allow it. Theme scripts run with full access to the app.",
  "settings-ui.themes.allow": "Allow script",
  "settings-ui.themes.declined": "The theme's script was not allowed.",
  "settings-ui.themes.author": "by {{author}}",
  "settings-ui.themes.no-variables": "This theme's palette has no variables to edit.",
  "settings-ui.sections.general.label": "General",
  "settings-ui.sections.appearance.label": "Appearance",
  "settings-ui.sections.window.label": "Window & Tray",
  "settings-ui.sections.advanced.label": "Advanced",
  "settings-ui.sections.plugins.label": "Plugins",
  "settings-ui.sections.flags.label": "Flags",
  "settings-ui.sections.about.label": "About",
  "settings-ui.about.tagline": "A feature-rich desktop app for YT Music",
  "settings-ui.about.versions": "Versions",
  "settings-ui.about.links": "Links",
  "settings-ui.about.actions": "Actions",
  "settings-ui.about.version-app": "App",
  "settings-ui.about.version-build": "Build",
  "settings-ui.about.version-electron": "Electron",
  "settings-ui.about.version-chromium": "Chromium",
  "settings-ui.about.version-node": "Node.js",
  "settings-ui.about.version-platform": "Platform",
  "settings-ui.about.version-innertube": "Innertube client version",
  "settings-ui.about.link-repo": "GitHub repository",
  "settings-ui.about.link-issue": "Report an issue",
  "settings-ui.about.link-releases": "Releases",
  "settings-ui.about.link-license": "License",
  "settings-ui.about.check-updates": "Check for updates",
  "settings-ui.about.copy-debug": "Copy debug info",
  "settings-ui.about.copied": "Copied!",
  "settings-ui.flags.warning":
    "These are YT Music's own experiment flags. Changing them can break the app; leave them alone unless you know what they do.",
  "settings-ui.flags.search-placeholder": "Search flags",
  "settings-ui.flags.add-name": "Flag name",
  "settings-ui.flags.add-value": "Value",
  "settings-ui.flags.add-value-hint": "true, false, a number, or text; JSON is parsed.",
  "settings-ui.flags.add": "Add",
  "settings-ui.flags.overridden": "overridden",
  "settings-ui.flags.undo": "Undo",
  "settings-ui.flags.undo-hint": "Put the page's own value back",
  "settings-ui.flags.no-match": "No flags match “{{query}}”.",
  "settings-ui.flags.empty": "No flags yet. Add one above, or open YT Music so the page reports its flags.",
} as const;

export type UiKey = keyof typeof UI_STRINGS;

export type Text = (key: UiKey, vars?: Vars) => string;

const fallbackT: Translate = (key, fallback) => fallback ?? key;
export const TranslateContext = createContext<Translate>(fallbackT);

/** The dialog's texts in the active language. */
export function useText(): Text {
  const t = useContext(TranslateContext);
  return (key, vars) => t(key, UI_STRINGS[key], vars);
}

/** A field with its texts in the active language (labels live next to the code, in English). */
export function localize(t: Translate, owner: string, name: string, field: Field): Field {
  const key = fieldKey(owner, name);
  return {
    ...field,
    label: t(`${key}.label`, field.label),
    ...(field.description && { description: t(`${key}.description`, field.description) }),
    ...(field.group && { group: t(groupKey(field.group), field.group) }),
    ...("placeholder" in field && field.placeholder && { placeholder: t(`${key}.placeholder`, field.placeholder) }),
    ...("options" in field && {
      options: field.options.map((option) => ({ ...option, label: t(`${key}.options.${option.value}`, option.label) })),
    }),
  };
}
