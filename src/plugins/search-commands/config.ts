export type SearchCommandsConfig = {
  enabled: boolean;
  /** Summon the search box from anywhere with `openKeybind`, Spotlight-style. */
  openShortcut: boolean;
  openKeybind: string;
};

export const defaultSearchCommandsConfig: SearchCommandsConfig = {
  enabled: true,
  openShortcut: true,
  openKeybind: 'CmdOrCtrl+/',
};
