/**
 * Appearance → Context menu lets the user leave entries out of YouTube Music's
 * three-dot menus.
 *
 * The menus are server-driven: every entry is a renderer object whose kind
 * (`menuServiceItemRenderer`, …) and endpoint (`queueAddEndpoint`,
 * `shareEntityEndpoint`, `nerdStatsEndpoint`, `browseEndpoint` page types, …) say
 * what it does. Matching those instead of the localized text or the rendered SVG
 * keeps the mapping valid across languages and icon refreshes.
 *
 * All menu renderers — player bar, queue rows, shelf cards, right-click — share
 * one popup behavior class, so wrapping its `openPopup` once filters
 * `menuPopupRenderer.items` before the menu is stamped: no DOM patching, no
 * flicker, and the listbox's keyboard/focus state never sees the hidden entries.
 */

type Icon = {
  iconType?: string;
};

type FormattedText = {
  runs?: { text?: string }[];
};

type BrowseEndpoint = {
  browseEndpointContextSupportedConfigs?: {
    browseEndpointContextMusicConfig?: {
      pageType?: string;
    };
  };
};

type MenuEndpoint = {
  addToPlaylistEndpoint?: unknown;
  browseEndpoint?: BrowseEndpoint;
  deletePlaylistEndpoint?: unknown;
  feedbackEndpoint?: unknown;
  flagEndpoint?: unknown;
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

const menuItemKinds = [
  'menuNavigationItemRenderer',
  'menuServiceItemRenderer',
  'menuServiceItemDownloadRenderer',
  'toggleMenuServiceItemRenderer',
] as const;

type MenuItemKind = (typeof menuItemKinds)[number];

/** One entry of a menu renderer's `items`: the kind is the only key. */
export type MenuItemData = Partial<Record<MenuItemKind, MenuItemRenderer>>;

type MenuEntry = {
  key: string;
  matches: (item: MenuItemData) => boolean;
};

export type MenuEntryKey = (typeof MENU_ENTRIES)[number]['key'];

const endpointKeys = [
  'navigationEndpoint',
  'serviceEndpoint',
  'defaultServiceEndpoint',
  'toggledServiceEndpoint',
] as const;

const rendererOf = (item: MenuItemData) => {
  const kind = Object.keys(item)[0] as MenuItemKind | undefined;
  return kind ? item[kind] : undefined;
};

const kindOf = (item: MenuItemData) =>
  Object.keys(item)[0] as MenuItemKind | undefined;

const endpointsOf = (renderer: MenuItemRenderer | undefined) =>
  renderer
    ? endpointKeys.flatMap((key) => {
        const endpoint = renderer[key];
        return endpoint ? [endpoint] : [];
      })
    : [];

const hasEndpoint = (
  renderer: MenuItemRenderer | undefined,
  endpoint: keyof MenuEndpoint,
) => endpointsOf(renderer).some((it) => it[endpoint] !== undefined);

const iconTypesOf = (renderer: MenuItemRenderer | undefined) =>
  renderer
    ? [
        renderer.icon?.iconType,
        renderer.defaultIcon?.iconType,
        renderer.toggledIcon?.iconType,
      ].filter((it): it is string => Boolean(it))
    : [];

const hasIcon = (
  renderer: MenuItemRenderer | undefined,
  iconTypes: readonly string[],
) => iconTypesOf(renderer).some((icon) => iconTypes.includes(icon));

const pageTypeOf = (renderer: MenuItemRenderer | undefined) => {
  for (const endpoint of endpointsOf(renderer)) {
    const pageType =
      endpoint.browseEndpoint?.browseEndpointContextSupportedConfigs
        ?.browseEndpointContextMusicConfig?.pageType;
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

/**
 * The entries the Appearance setting knows about. `matches` is tried in order, so
 * more specific entries come first; an entry YouTube Music adds later matches
 * nothing and stays visible.
 */
export const MENU_ENTRIES = [
  {
    // The dedicated renderer is the only way YTM renders the offline entry.
    key: 'download',
    matches: (item) => kindOf(item) === 'menuServiceItemDownloadRenderer',
  },
  {
    key: 'like',
    matches: (item) =>
      kindOf(item) === 'toggleMenuServiceItemRenderer' &&
      (hasIcon(rendererOf(item), ['FAVORITE', 'UNFAVORITE']) ||
        hasEndpoint(rendererOf(item), 'likeEndpoint')),
  },
  {
    key: 'save-to-library',
    matches: (item) =>
      kindOf(item) === 'toggleMenuServiceItemRenderer' &&
      hasIcon(rendererOf(item), ['BOOKMARK_BORDER', 'BOOKMARK']),
  },
  {
    key: 'play-next',
    matches: (item) =>
      queuePositionOf(rendererOf(item)) === 'INSERT_AFTER_CURRENT_VIDEO',
  },
  {
    key: 'add-to-queue',
    matches: (item) => queuePositionOf(rendererOf(item)) === 'INSERT_AT_END',
  },
  {
    key: 'remove-from-queue',
    matches: (item) => hasEndpoint(rendererOf(item), 'removeFromQueueEndpoint'),
  },
  {
    key: 'shuffle-play',
    matches: (item) => hasIcon(rendererOf(item), ['MUSIC_SHUFFLE', 'SHUFFLE']),
  },
  {
    key: 'start-mix',
    matches: (item) => hasIcon(rendererOf(item), ['MIX']),
  },
  {
    key: 'save-to-playlist',
    matches: (item) => {
      const renderer = rendererOf(item);
      // Signed in, the endpoint names the action. Signed out, YTM wraps the same
      // entry in a sign-in modal and only the icon still says what it would do.
      return (
        hasEndpoint(renderer, 'addToPlaylistEndpoint') ||
        (hasEndpoint(renderer, 'modalEndpoint') &&
          hasIcon(renderer, ['ADD_TO_PLAYLIST']))
      );
    },
  },
  {
    key: 'go-to-artist',
    matches: (item) =>
      pageTypeOf(rendererOf(item)) === 'MUSIC_PAGE_TYPE_ARTIST',
  },
  {
    key: 'go-to-album',
    matches: (item) => pageTypeOf(rendererOf(item)) === 'MUSIC_PAGE_TYPE_ALBUM',
  },
  {
    key: 'go-to-playlist',
    matches: (item) =>
      pageTypeOf(rendererOf(item)) === 'MUSIC_PAGE_TYPE_PLAYLIST',
  },
  {
    key: 'share',
    matches: (item) =>
      hasEndpoint(rendererOf(item), 'shareEntityEndpoint') ||
      hasEndpoint(rendererOf(item), 'shareEndpoint'),
  },
  {
    key: 'report',
    matches: (item) => {
      const renderer = rendererOf(item);
      return (
        hasEndpoint(renderer, 'flagEndpoint') ||
        (hasEndpoint(renderer, 'modalEndpoint') && hasIcon(renderer, ['FLAG']))
      );
    },
  },
  {
    key: 'stats-for-nerds',
    matches: (item) => hasEndpoint(rendererOf(item), 'nerdStatsEndpoint'),
  },
  {
    key: 'not-interested',
    matches: (item) =>
      hasEndpoint(rendererOf(item), 'feedbackEndpoint') &&
      hasIcon(rendererOf(item), ['NOT_INTERESTED']),
  },
  {
    key: 'remove-from-playlist',
    matches: (item) =>
      playlistActionsOf(rendererOf(item)).includes('ACTION_REMOVE_VIDEO'),
  },
  {
    key: 'delete-playlist',
    matches: (item) => hasEndpoint(rendererOf(item), 'deletePlaylistEndpoint'),
  },
] as const satisfies readonly MenuEntry[];

/** The key of the entry `item` is, or null when it is none of the known ones. */
export const menuEntryKeyOf = (item: MenuItemData): MenuEntryKey | null =>
  MENU_ENTRIES.find((entry) => entry.matches(item))?.key ?? null;

/**
 * `items` without the hidden entries. Unknown entries are kept, so a menu YTM
 * grows a new action in still shows it.
 */
export const hideMenuEntries = (
  items: readonly MenuItemData[],
  hiddenEntries: readonly string[],
): MenuItemData[] => {
  if (!hiddenEntries.length) return [...items];

  const hidden = new Set(hiddenEntries);
  return items.filter((item) => {
    const key = menuEntryKeyOf(item);
    return key === null || !hidden.has(key);
  });
};

/** The entry keys switched on in `options.contextMenuHidden`. */
export const hiddenEntryKeys = (hidden: Record<string, boolean> = {}) =>
  Object.entries(hidden)
    .filter(([, isHidden]) => isHidden)
    .map(([key]) => key);

type PopupAction = {
  openPopupAction?: {
    popup?: {
      menuPopupRenderer?: {
        items?: MenuItemData[];
      };
    };
  };
};

type OpenPopupBehavior = {
  openPopup: (action: unknown) => unknown;
};

type MenuRendererElement = HTMLElement & {
  openPopupBehavior?: OpenPopupBehavior;
};

let hiddenEntries: string[] = [];
let observer: MutationObserver | undefined;
let patched:
  | {
      prototype: OpenPopupBehavior;
      openPopup: OpenPopupBehavior['openPopup'];
    }
  | undefined;

const filterMenuAction = (action: unknown): unknown => {
  if (!hiddenEntries.length) return action;

  const openPopup = (action as PopupAction | null)?.openPopupAction;
  const popup = openPopup?.popup;
  const menu = popup?.menuPopupRenderer;
  const items = menu?.items;
  if (!menu || !Array.isArray(items) || items.length === 0) return action;

  const kept = hideMenuEntries(items, hiddenEntries);
  if (kept.length === items.length) return action;

  return {
    ...(action as PopupAction),
    openPopupAction: {
      ...openPopup,
      popup: { ...popup, menuPopupRenderer: { ...menu, items: kept } },
    },
  };
};

const findBehavior = () =>
  document.querySelector<MenuRendererElement>('ytmusic-menu-renderer')
    ?.openPopupBehavior;

/** Wraps the shared popup behavior once a menu renderer exists. */
const patchMenuBehavior = (behavior: OpenPopupBehavior) => {
  const popupPrototype = Object.getPrototypeOf(behavior) as OpenPopupBehavior;
  const openPopup = popupPrototype.openPopup;
  if (typeof openPopup !== 'function' || patched) return false;

  popupPrototype.openPopup = function (
    this: OpenPopupBehavior,
    action: unknown,
  ) {
    return openPopup.call(this, filterMenuAction(action));
  };
  patched = { prototype: popupPrototype, openPopup };
  return true;
};

/** Menus appear with the first page render, so watch until one exists. */
const watchForMenu = () => {
  const behavior = findBehavior();
  if (behavior && patchMenuBehavior(behavior)) return;

  observer = new MutationObserver(() => {
    const found = findBehavior();
    if (!found || !patchMenuBehavior(found)) return;
    observer?.disconnect();
    observer = undefined;
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
};

export const startContextMenuCustomizer = (
  initialHidden: Record<string, boolean>,
) => {
  hiddenEntries = hiddenEntryKeys(initialHidden);
  watchForMenu();
};

/** Called when an Appearance switch changes; menus pick it up on next open. */
export const setContextMenuHiddenEntry = (
  entryKey: string,
  isHidden: boolean,
) => {
  const next = new Set(hiddenEntries);
  if (isHidden) next.add(entryKey);
  else next.delete(entryKey);
  hiddenEntries = [...next];
};
