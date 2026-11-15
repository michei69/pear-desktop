// Music's three-dot menus are server-driven: every entry is a renderer
// object whose kind and endpoint say what it does. Matching those (rather than
// the localized text or icon artwork) keeps the mapping valid across languages.
//
// The DOM half lives in @pear/page's context-menu module; this file has no DOM
// dependencies, so the migrations can share the entry keys.

type Icon = { iconType?: string };
type FormattedText = { runs?: { text?: string }[] };
type BrowseEndpoint = {
  browseEndpointContextSupportedConfigs?: { browseEndpointContextMusicConfig?: { pageType?: string } };
};
type MenuEndpoint = {
  addToPlaylistEndpoint?: unknown;
  browseEndpoint?: BrowseEndpoint;
  deletePlaylistEndpoint?: unknown;
  feedbackEndpoint?: unknown;
  flagEndpoint?: unknown;
  getReportFormEndpoint?: unknown;
  likeEndpoint?: unknown;
  modalEndpoint?: unknown;
  nerdStatsEndpoint?: unknown;
  offlinePlaylistEndpoint?: unknown;
  offlineVideoEndpoint?: unknown;
  playlistEditEndpoint?: { actions?: { action?: string }[] };
  queueAddEndpoint?: { queueInsertPosition?: string };
  removeFromQueueEndpoint?: unknown;
  shareEndpoint?: unknown;
  shareEntityEndpoint?: unknown;
  watchEndpoint?: unknown;
  watchPlaylistEndpoint?: unknown;
};
type MenuItemRenderer = {
  text?: FormattedText;
  icon?: Icon;
  defaultIcon?: Icon;
  toggledIcon?: Icon;
  navigationEndpoint?: MenuEndpoint;
  serviceEndpoint?: MenuEndpoint;
  defaultServiceEndpoint?: MenuEndpoint;
  toggledServiceEndpoint?: MenuEndpoint;
};

const MENU_ITEM_KINDS = [
  "menuNavigationItemRenderer",
  "menuServiceItemRenderer",
  "menuServiceItemDownloadRenderer",
  "toggleMenuServiceItemRenderer",
] as const;

type MenuItemKind = (typeof MENU_ITEM_KINDS)[number];

/** One entry of a menu renderer's `items`: the kind is the only key. */
export type MenuItemData = Partial<Record<MenuItemKind, MenuItemRenderer>>;

const ENDPOINT_KEYS = ["navigationEndpoint", "serviceEndpoint", "defaultServiceEndpoint", "toggledServiceEndpoint"] as const;

const rendererOf = (item: MenuItemData) => {
  const kind = Object.keys(item)[0] as MenuItemKind | undefined;
  return kind ? item[kind] : undefined;
};

const kindOf = (item: MenuItemData) => Object.keys(item)[0] as MenuItemKind | undefined;

const endpointsOf = (renderer: MenuItemRenderer | undefined) =>
  renderer
    ? ENDPOINT_KEYS.flatMap((key) => {
        const endpoint = renderer[key];
        return endpoint ? [endpoint] : [];
      })
    : [];

const hasEndpoint = (renderer: MenuItemRenderer | undefined, endpoint: keyof MenuEndpoint) =>
  endpointsOf(renderer).some((it) => it[endpoint] !== undefined);

const iconTypesOf = (renderer: MenuItemRenderer | undefined) =>
  renderer
    ? [renderer.icon?.iconType, renderer.defaultIcon?.iconType, renderer.toggledIcon?.iconType].filter((it): it is string => Boolean(it))
    : [];

const hasIcon = (renderer: MenuItemRenderer | undefined, iconTypes: readonly string[]) =>
  iconTypesOf(renderer).some((icon) => iconTypes.includes(icon));

const pageTypeOf = (renderer: MenuItemRenderer | undefined) => {
  for (const endpoint of endpointsOf(renderer)) {
    const pageType = endpoint.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
    if (pageType) return pageType;
  }
  return undefined;
};

const queuePositionOf = (renderer: MenuItemRenderer | undefined) => {
  for (const endpoint of endpointsOf(renderer)) {
    const position = endpoint.queueAddEndpoint?.queueInsertPosition;
    if (position) return position;
  }
  return undefined;
};

const playlistActionsOf = (renderer: MenuItemRenderer | undefined) => {
  for (const endpoint of endpointsOf(renderer)) {
    const actions = endpoint.playlistEditEndpoint?.actions;
    if (actions) return actions.map((action) => action.action);
  }
  return [];
};

export interface ContextMenuEntry {
  /** The entry's id, used in the hidden-entry list. */
  key: string;
  /** The id the setting stores (`options.contextMenu<Entry>`). */
  configKey: string;
  /** The name shown in the settings switch. */
  label: string;
  matches: (item: MenuItemData) => boolean;
}

/** An entry as declared, before its config key is derived from `key`. */
type MenuEntry = Omit<ContextMenuEntry, "configKey">;

/**
 * The entries the Appearance setting knows about. `matches` is tried in order,
 * so more specific entries come first; an entry Music adds later
 * matches nothing and stays visible.
 */
const MENU_ENTRIES = [
  // The dedicated renderer is the only way YTM renders the offline entry.
  { key: "download", label: "Download", matches: (item) => kindOf(item) === "menuServiceItemDownloadRenderer" },
  {
    key: "like",
    label: "Like",
    matches: (item) =>
      kindOf(item) === "toggleMenuServiceItemRenderer" &&
      (hasIcon(rendererOf(item), ["FAVORITE", "UNFAVORITE"]) || hasEndpoint(rendererOf(item), "likeEndpoint")),
  },
  {
    key: "save-to-library",
    label: "Save to library",
    matches: (item) => kindOf(item) === "toggleMenuServiceItemRenderer" && hasIcon(rendererOf(item), ["BOOKMARK_BORDER", "BOOKMARK"]),
  },
  {
    key: "play-next",
    label: "Play next",
    matches: (item) => queuePositionOf(rendererOf(item)) === "INSERT_AFTER_CURRENT_VIDEO",
  },
  {
    key: "add-to-queue",
    label: "Add to queue",
    matches: (item) => queuePositionOf(rendererOf(item)) === "INSERT_AT_END",
  },
  {
    key: "remove-from-queue",
    label: "Remove from queue",
    matches: (item) => hasEndpoint(rendererOf(item), "removeFromQueueEndpoint"),
  },
  {
    key: "shuffle-play",
    label: "Shuffle play",
    matches: (item) => hasIcon(rendererOf(item), ["MUSIC_SHUFFLE", "SHUFFLE"]),
  },
  { key: "start-mix", label: "Start mix", matches: (item) => hasIcon(rendererOf(item), ["MIX"]) },
  {
    key: "save-to-playlist",
    label: "Save to playlist",
    matches: (item) => {
      const renderer = rendererOf(item);
      // Signed in, the endpoint names the action. Signed out, YTM wraps the same
      // entry in a sign-in modal and only the icon still says what it would do.
      return (
        hasEndpoint(renderer, "addToPlaylistEndpoint") || (hasEndpoint(renderer, "modalEndpoint") && hasIcon(renderer, ["ADD_TO_PLAYLIST"]))
      );
    },
  },
  { key: "go-to-artist", label: "Go to artist", matches: (item) => pageTypeOf(rendererOf(item)) === "MUSIC_PAGE_TYPE_ARTIST" },
  { key: "go-to-album", label: "Go to album", matches: (item) => pageTypeOf(rendererOf(item)) === "MUSIC_PAGE_TYPE_ALBUM" },
  {
    key: "go-to-playlist",
    label: "Go to playlist",
    matches: (item) => pageTypeOf(rendererOf(item)) === "MUSIC_PAGE_TYPE_PLAYLIST",
  },
  {
    key: "share",
    label: "Share",
    matches: (item) => hasEndpoint(rendererOf(item), "shareEntityEndpoint") || hasEndpoint(rendererOf(item), "shareEndpoint"),
  },
  {
    key: "report",
    label: "Report",
    matches: (item) => {
      const renderer = rendererOf(item);
      return (
        hasEndpoint(renderer, "flagEndpoint") ||
        hasEndpoint(renderer, "getReportFormEndpoint") ||
        (hasEndpoint(renderer, "modalEndpoint") && hasIcon(renderer, ["FLAG"]))
      );
    },
  },
  { key: "stats-for-nerds", label: "Stats for nerds", matches: (item) => hasEndpoint(rendererOf(item), "nerdStatsEndpoint") },
  {
    key: "pin-to-listen-again",
    label: "Pin to listen again",
    matches: (item) =>
      kindOf(item) === "toggleMenuServiceItemRenderer" &&
      hasEndpoint(rendererOf(item), "feedbackEndpoint") &&
      hasIcon(rendererOf(item), ["KEEP"]),
  },
  {
    key: "not-interested",
    label: "Not interested",
    matches: (item) => hasEndpoint(rendererOf(item), "feedbackEndpoint") && hasIcon(rendererOf(item), ["NOT_INTERESTED"]),
  },
  {
    key: "remove-from-playlist",
    label: "Remove from playlist",
    matches: (item) => playlistActionsOf(rendererOf(item)).includes("ACTION_REMOVE_VIDEO"),
  },
  {
    // The queue's "Dismiss queue" shares `deletePlaylistEndpoint` with a real
    // playlist delete; the icon is the only thing that tells them apart.
    key: "dismiss-queue",
    label: "Dismiss queue",
    matches: (item) => hasEndpoint(rendererOf(item), "deletePlaylistEndpoint") && hasIcon(rendererOf(item), ["DISMISS_QUEUE"]),
  },
  { key: "delete-playlist", label: "Delete playlist", matches: (item) => hasEndpoint(rendererOf(item), "deletePlaylistEndpoint") },
] as const satisfies readonly MenuEntry[];

export const CONTEXT_MENU_ENTRIES: readonly ContextMenuEntry[] = MENU_ENTRIES.map((entry) => ({
  ...entry,
  // `contextMenuDownload`, `contextMenuSaveToLibrary`, ...
  configKey: `contextMenu${entry.key
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")}`,
}));

export type ContextMenuEntryKey = (typeof MENU_ENTRIES)[number]["key"];

/** The key of the entry `item` is, or null when it is none of the known ones. */
export const menuEntryKeyOf = (item: MenuItemData): string | null => CONTEXT_MENU_ENTRIES.find((entry) => entry.matches(item))?.key ?? null;

/** `items` without the hidden entries. Unknown entries are kept, so a menu YTM grows still shows it. */
export const hideMenuEntries = (items: readonly MenuItemData[], hiddenEntries: readonly string[]): MenuItemData[] => {
  if (!hiddenEntries.length) return [...items];

  const hidden = new Set(hiddenEntries);
  return items.filter((item) => {
    const key = menuEntryKeyOf(item);
    return key === null || !hidden.has(key);
  });
};
