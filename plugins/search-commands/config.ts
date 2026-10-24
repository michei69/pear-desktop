import { config } from "@pear/sdk";

export const schema = {
  openShortcut: config.bool(true, {
    label: "Spotlight shortcut",
    description: "Summons the command box from anywhere in the window.",
  }),
  openKeybind: config.shortcut("CmdOrCtrl+/", {
    label: "Shortcut",
    description: "An Electron accelerator, e.g. CmdOrCtrl+/. Leave empty to use no shortcut.",
  }),
};

/** Host command the page calls for the `/settings` command. */
export interface SearchCommands {
  openSettings(): void;
}
