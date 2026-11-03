import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

import { defaultConfig } from '@/config/defaults';
import { t } from '@/i18n';
import {
  isAlbumOrPlaylist,
  isMusicOrVideoTrack,
} from '@/plugins/utils/renderer/check';
import { getSongMenu } from '@/providers/dom-elements';
import { getSongInfo } from '@/providers/song-info-front';

import { DownloadButton } from './templates/download';

import type { DownloaderPluginConfig } from './index';
import type { RendererContext } from '@/types/contexts';

const [downloadButtonText, setDownloadButtonText] = createSignal<string>('');

let download: () => void = () => {};

let buttonContainer: HTMLDivElement | null = null;
let feedbackListener: ((feedback: string) => void) | undefined;
let disposeButton: (() => void) | undefined;
let popupContainerObserver: MutationObserver | undefined;

const menuObserver = new MutationObserver(() => {
  const menu = getSongMenu();

  if (
    !menu ||
    !buttonContainer ||
    menu.contains(buttonContainer) ||
    !(isMusicOrVideoTrack() || isAlbumOrPlaylist())
  ) {
    return;
  }

  menu.prepend(buttonContainer);
});

const observePopupContainer = () => {
  const popupContainer = document.querySelector('ytmusic-popup-container');
  if (!popupContainer) return false;

  menuObserver.observe(popupContainer, {
    childList: true,
    subtree: true,
  });
  return true;
};

export const onRendererLoad = ({
  ipc,
}: RendererContext<DownloaderPluginConfig>) => {
  download = () => {
    const songMenu = getSongMenu();

    let videoUrl = songMenu
      ?.querySelector(
        'ytmusic-menu-navigation-item-renderer[tabindex="0"] #navigation-endpoint',
      )
      ?.getAttribute('href');

    if (!videoUrl && songMenu) {
      for (const it of songMenu.querySelectorAll(
        'ytmusic-menu-navigation-item-renderer[tabindex="-1"] #navigation-endpoint',
      )) {
        if (it.getAttribute('href')?.includes('podcast/')) {
          videoUrl = it.getAttribute('href');
          break;
        }
      }
    }

    if (videoUrl) {
      if (videoUrl.startsWith('watch?')) {
        videoUrl = defaultConfig.url + '/' + videoUrl;
      }

      if (videoUrl.startsWith('podcast/')) {
        videoUrl =
          defaultConfig.url + '/watch?' + videoUrl.replace('podcast/', 'v=');
      }

      if (videoUrl.includes('?playlist=')) {
        ipc.invoke('download-playlist-request', videoUrl);
        return;
      }
    } else {
      videoUrl = getSongInfo().url || window.location.href;
    }

    ipc.invoke('download-song', videoUrl);
  };

  feedbackListener = (feedback: string) => {
    setDownloadButtonText(feedback || t('plugins.downloader.templates.button'));
  };
  ipc.on('downloader-feedback', feedbackListener);

  setDownloadButtonText(t('plugins.downloader.templates.button'));

  buttonContainer = document.createElement('div');
  buttonContainer.classList.add(
    'style-scope',
    'menu-item',
    'ytmusic-menu-popup-renderer',
  );
  buttonContainer.setAttribute('aria-disabled', 'false');
  buttonContainer.setAttribute('aria-selected', 'false');
  buttonContainer.setAttribute('role', 'option');
  buttonContainer.setAttribute('tabindex', '-1');

  disposeButton = render(
    () => (
      <DownloadButton onClick={() => download()} text={downloadButtonText()} />
    ),
    buttonContainer,
  );

  // The popup container can be created after plugin load; observe the document
  // until it exists instead of polling on a timer.
  if (!observePopupContainer()) {
    popupContainerObserver = new MutationObserver(() => {
      if (observePopupContainer()) popupContainerObserver?.disconnect();
    });
    popupContainerObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
};

export const onRendererStop = ({
  ipc,
}: RendererContext<DownloaderPluginConfig>) => {
  popupContainerObserver?.disconnect();
  popupContainerObserver = undefined;
  menuObserver.disconnect();

  if (feedbackListener) {
    ipc.off('downloader-feedback', feedbackListener);
    feedbackListener = undefined;
  }

  disposeButton?.();
  disposeButton = undefined;

  buttonContainer?.remove();
  buttonContainer = null;

  download = () => {};
};
