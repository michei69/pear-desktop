// The two page decisions of the latch: whether a click starts playback (the
// header Shuffle control and the menus' "Shuffle play", as well as the play
// buttons and track links), and whether YTM's player page is open. Kept free of
// the page context so both can be tested on their own.

type IconElement = Element & { icon?: string };
type RendererElement = Element & { data?: { icon?: { iconType?: string } } };

const iconNameOf = (element: Element | null) => {
  if (!element) return "";
  return element.getAttribute("icon") ?? (element as IconElement).icon ?? "";
};

/** The icon inside the clicked control: the icon itself, or the one its button renders. */
const iconElementOf = (target: Element) => {
  const clickedIcon = target.closest("yt-icon");
  if (clickedIcon) return clickedIcon;

  const control = target.closest(
    "ytmusic-menu-navigation-item-renderer, ytmusic-menu-service-item-renderer, ytmusic-play-button-renderer, yt-icon-button",
  );
  return control?.querySelector("yt-icon") ?? null;
};

/**
 * Whether the click is on a shuffle control: the header's icon button (whose
 * classes do not change with the UI language) or a menu entry.
 */
export const isShuffleControl = (target: Element) => {
  if (iconNameOf(iconElementOf(target)).toLowerCase().includes("shuffle")) return true;

  const iconButton = target.closest("yt-icon-button");
  if (iconButton?.classList.contains("shuffle") || iconButton?.classList.contains("expand-shuffle")) return true;

  const menuItem = target.closest("ytmusic-menu-navigation-item-renderer, ytmusic-menu-service-item-renderer");
  if (!menuItem) return false;

  const iconType = (menuItem as RendererElement).data?.icon?.iconType ?? "";
  return iconType.toLowerCase().includes("shuffle") || iconNameOf(menuItem.querySelector("yt-icon")).toLowerCase().includes("shuffle");
};

/**
 * Whether YTM has the player page open. The layouts report it in three ways:
 * the `player-ui-state` attribute, a plain `player-page-open` one, or only the
 * page element's own flag; a missing attribute must not read as "closed".
 */
export const isPlayerPageOpen = (layout: Element | null, page: Element | null) => {
  const state = layout?.getAttribute("player-ui-state");
  if (state) return state === "PLAYER_PAGE_OPEN";
  if (layout) return layout.hasAttribute("player-page-open");
  return (page as (Element & { playerPageOpen_?: boolean }) | null)?.playerPageOpen_ === true;
};
