import { toKeyEvent } from 'keyboardevent-from-electron-accelerator';
import keyEventAreEqual from 'keyboardevents-areequal';
import { render } from 'solid-js/web';

import { t } from '@/i18n';
import {
  isMusicOrVideoTrack,
  isPlayerMenu,
} from '@/plugins/utils/renderer/check';
import { getSongMenu } from '@/providers/dom-elements';
import { observePlayerPage } from '@/providers/player-page-observer';

import { PictureInPictureButton } from './templates/picture-in-picture-button';

import type { PictureInPicturePluginConfig } from './index';
import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

const cleanups: Array<() => void> = [];
let generation = 0;

const runCleanups = () => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
};

export const onPlayerApiReady = async (
  _: MusicPlayer,
  { ipc, getConfig }: RendererContext<PictureInPicturePluginConfig>,
) => {
  const currentGeneration = ++generation;
  runCleanups();

  const config = await getConfig();
  if (currentGeneration !== generation) return;

  const togglePictureInPicture = async () => {
    if ((await getConfig()).useNativePiP) {
      const isInPiP = document.pictureInPictureElement !== null;
      const video = document.querySelector<HTMLVideoElement>('video');
      const togglePiP = () =>
        isInPiP
          ? document.exitPictureInPicture()
          : video?.requestPictureInPicture();

      try {
        await togglePiP();
        document.querySelector<HTMLButtonElement>('#icon')?.click();
        return true;
      } catch {}
    }

    ipc.send('plugin:toggle-picture-in-picture');
    return false;
  };

  if (config.hotkey) {
    try {
      const hotkeyEvent = toKeyEvent(config.hotkey);
      const onKeydown = (event: KeyboardEvent) => {
        if (
          keyEventAreEqual(event, hotkeyEvent) &&
          !document.querySelector<HTMLElement & { opened: boolean }>(
            'ytmusic-search-box',
          )?.opened
        ) {
          togglePictureInPicture();
        }
      };

      window.addEventListener('keydown', onKeydown);
      cleanups.push(() => window.removeEventListener('keydown', onKeydown));
    } catch (error) {
      console.warn('Could not register the picture-in-picture hotkey', error);
    }
  }

  const exitFullScreenButton = document.querySelector<HTMLButtonElement>(
    '.exit-fullscreen-button',
  );
  const getPlayMinimizeButton = () =>
    document.querySelector('.player-minimize-button');
  const appLayout = document.querySelector<HTMLElement>('ytmusic-app-layout');
  const expandMenu = document.querySelector<HTMLElement>('#expanding-menu');
  const middleControls =
    document.querySelector<HTMLButtonElement>('.middle-controls');
  const playerPage = document.querySelector<
    HTMLElement & { playerPageOpen_: boolean }
  >('ytmusic-player-page');
  const togglePlayerPageButton = document.querySelector<HTMLButtonElement>(
    '.toggle-player-page-button',
  );
  const fullScreenButton =
    document.querySelector<HTMLButtonElement>('.fullscreen-button');
  const player = document.querySelector<
    HTMLVideoElement & { onDoubleClick_: (() => void) | undefined }
  >('#player');
  const onPlayerDblClick = player?.onDoubleClick_;
  const mouseLeaveEventListener = () => middleControls?.click();

  const titleBar = document.querySelector<HTMLElement>(
    'nav[data-ytmd-main-panel]',
  );

  const pipClickEventListener = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    togglePictureInPicture();
  };

  // Main still believes PiP after a renderer reload; seed the flag or exitPip() no-ops.
  let inPiP = Boolean(config.isInPiP);

  const enterPip = () => {
    exitFullScreenButton?.addEventListener('click', pipClickEventListener);
    getPlayMinimizeButton()?.removeEventListener(
      'click',
      pipClickEventListener,
    );
    if (player) {
      player.onDoubleClick_ = () => {};
    }

    expandMenu?.addEventListener('mouseleave', mouseLeaveEventListener);
    if (!playerPage?.playerPageOpen_) {
      togglePlayerPageButton?.click();
    }

    fullScreenButton?.click();
    appLayout?.classList.add('pip');
    if (titleBar) {
      titleBar.style.display = 'none';
    }
    inPiP = true;
  };

  const exitPip = () => {
    if (!inPiP) {
      return;
    }

    inPiP = false;
    exitFullScreenButton?.removeEventListener('click', pipClickEventListener);
    getPlayMinimizeButton()?.addEventListener('click', pipClickEventListener);
    if (player) {
      player.onDoubleClick_ = onPlayerDblClick;
    }
    expandMenu?.removeEventListener('mouseleave', mouseLeaveEventListener);
    exitFullScreenButton?.click();
    appLayout?.classList.remove('pip');
    if (titleBar) {
      titleBar.style.display = 'flex';
    }
  };

  const pipButtonContainer = document.createElement('div');
  pipButtonContainer.classList.add(
    'style-scope',
    'menu-item',
    'ytmusic-menu-popup-renderer',
  );
  pipButtonContainer.setAttribute('aria-disabled', 'false');
  pipButtonContainer.setAttribute('aria-selected', 'false');
  pipButtonContainer.setAttribute('role', 'option');
  pipButtonContainer.setAttribute('tabindex', '-1');

  const disposeButton = render(
    () => (
      <PictureInPictureButton
        onClick={togglePictureInPicture}
        text={t('plugins.picture-in-picture.templates.button')}
      />
    ),
    pipButtonContainer,
  );

  const onPipToggle = (isPip: boolean) => {
    if (!exitFullScreenButton || !player) {
      return;
    }

    if (isPip) {
      enterPip();
    } else {
      exitPip();
    }
  };

  ipc.on('peard:pip-toggle', onPipToggle);
  getPlayMinimizeButton()?.addEventListener('click', pipClickEventListener);

  const unwatchPopup = observePlayerPage('ytmusic-popup-container', {
    childList: true,
    subtree: true,
    callback: () => {
      const menu = getSongMenu();

      if (
        menu?.contains(pipButtonContainer) ||
        !isMusicOrVideoTrack() ||
        !isPlayerMenu(menu)
      ) {
        return;
      }

      menu?.prepend(pipButtonContainer);
    },
  });

  cleanups.push(() => {
    exitPip();
    ipc.off('peard:pip-toggle', onPipToggle);
    exitFullScreenButton?.removeEventListener('click', pipClickEventListener);
    getPlayMinimizeButton()?.removeEventListener(
      'click',
      pipClickEventListener,
    );
    unwatchPopup();
    disposeButton();
    pipButtonContainer.remove();
  });
};

export const onUnload = () => {
  generation++;
  runCleanups();
};
