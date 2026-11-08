import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import style from './style.css?inline';

const DID_PLAY_CLASS = 'unobtrusive-player--did-play';
const AUTO_CLOSING_CLASS = 'unobtrusive-player--auto-closing';

type IconElement = Element & { icon?: string };
type RendererElement = Element & { data?: { icon?: { iconType?: string } } };

const iconNameOf = (element: Element | null) => {
  if (!element) return '';
  return element.getAttribute('icon') ?? (element as IconElement).icon ?? '';
};

const getIconElement = (target: Element): Element | null => {
  const clickedIcon = target.closest('yt-icon');
  if (clickedIcon) return clickedIcon;

  const clickedControl = target.closest(
    'ytmusic-menu-navigation-item-renderer, ytmusic-menu-service-item-renderer, ytmusic-play-button-renderer, yt-icon-button',
  );
  return clickedControl?.querySelector('yt-icon') ?? null;
};

const isShuffleControl = (target: Element) => {
  if (iconNameOf(getIconElement(target)).toLowerCase().includes('shuffle')) {
    return true;
  }

  const iconButton = target.closest('yt-icon-button');
  if (
    iconButton?.classList.contains('shuffle') ||
    iconButton?.classList.contains('expand-shuffle')
  ) {
    return true;
  }

  const menuItem = target.closest(
    'ytmusic-menu-navigation-item-renderer, ytmusic-menu-service-item-renderer',
  );
  if (!menuItem) return false;

  const iconType = (menuItem as RendererElement).data?.icon?.iconType ?? '';
  return (
    iconType.toLowerCase().includes('shuffle') ||
    iconNameOf(menuItem.querySelector('yt-icon'))
      .toLowerCase()
      .includes('shuffle')
  );
};

const handlePlay = (e: MouseEvent) => {
  if (!(e.target instanceof Element)) return;

  if (
    e.target.closest('ytmusic-player-bar') &&
    !document.body.classList.contains(AUTO_CLOSING_CLASS)
  ) {
    document.body.classList.remove(DID_PLAY_CLASS);
    return;
  }

  if (e.target.closest('ytmusic-player-page')) return;

  if (
    e.target.closest('ytmusic-play-button-renderer') ||
    isShuffleControl(e.target)
  ) {
    document.body.classList.add(DID_PLAY_CLASS);
  }
};

const isPlayerPageOpen = () => {
  const appLayout =
    document.querySelector('ytmusic-app-layout') ??
    document.querySelector('#layout');
  const playerUiState = appLayout?.getAttribute('player-ui-state');
  if (playerUiState) return playerUiState === 'PLAYER_PAGE_OPEN';
  if (appLayout) return appLayout.hasAttribute('player-page-open');

  const playerPage = document.querySelector<
    HTMLElement & { playerPageOpen_?: boolean }
  >('ytmusic-player-page');
  return playerPage?.playerPageOpen_ === true;
};

const handleVideoDataChange = () => {
  if (!document.body.classList.contains(DID_PLAY_CLASS)) return;
  // A second change while closing would click the toggle and reopen the page.
  if (document.body.classList.contains(AUTO_CLOSING_CLASS)) return;
  if (!isPlayerPageOpen()) return;

  document.body.classList.add(AUTO_CLOSING_CLASS);

  document
    .querySelector<HTMLButtonElement>('.toggle-player-page-button')
    ?.click();

  // prevent animation flickering
  setTimeout(() => {
    document.body.classList.remove(AUTO_CLOSING_CLASS);
    // Only latch DID_PLAY if the page closed, or later tracks force-close it.
    if (isPlayerPageOpen()) document.body.classList.remove(DID_PLAY_CLASS);
  }, 500);
};

export default createPlugin({
  name: () => t('plugins.unobtrusive-player.name'),
  description: () => t('plugins.unobtrusive-player.description'),
  addedVersion: '3.8.x',
  restartNeeded: false,
  config: {
    enabled: false,
  },
  stylesheets: [style],
  renderer: {
    start: () => {
      document.body.classList.add('unobtrusive-player');
      document.addEventListener('click', handlePlay);
    },
    onPlayerApiReady: () => {
      // Close the player page when the video changes while `unobtrusive-player--did-play` is set
      document.addEventListener('videodatachange', handleVideoDataChange);
    },
    stop: () => {
      document.removeEventListener('click', handlePlay);
      document.removeEventListener('videodatachange', handleVideoDataChange);

      ['unobtrusive-player', DID_PLAY_CLASS, AUTO_CLOSING_CLASS].forEach(
        (className) => document.body.classList.remove(className),
      );
    },
  },
});
