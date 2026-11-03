import { createSignal, untrack } from 'solid-js';
import { render } from 'solid-js/web';

import { t } from '@/i18n';
import {
  isMusicOrVideoTrack,
  isPlayerMenu,
} from '@/plugins/utils/renderer/check';
import { getSongMenu } from '@/providers/dom-elements';
import { observePlayerPage } from '@/providers/player-page-observer';
import { type RendererContext } from '@/types/contexts';

import { SettingsSlider } from './components/SettingsSlider';
import { PlaybackSpeedSlider } from './components/slider';
import {
  MAX_PLAYBACK_SPEED,
  MIN_PLAYBACK_SPEED,
  normalizePlaybackSpeed,
} from './speed';
import { StartupLifecycle } from './startup-lifecycle';

import type { PlaybackSpeedConfig } from './index';

export const components = { settingsSlider: SettingsSlider };

let currentConfig: PlaybackSpeedConfig | null = null;
let currentContext: RendererContext<PlaybackSpeedConfig> | null = null;
let activeVideo: HTMLVideoElement | null = null;
let unwatchVideo: (() => void) | null = null;
let unwatchPopup: (() => void) | null = null;
let disposeSlider: (() => void) | undefined;
const startupLifecycle = new StartupLifecycle();
const observedVideos = new Set<HTMLVideoElement>();

export const onConfigChange = (newConfig: PlaybackSpeedConfig) => {
  currentConfig = newConfig;
  setSpeed(normalizePlaybackSpeed(newConfig.playbackSpeed));

  for (const video of observedVideos) {
    updatePlayBackSpeed(video);
  }

  if (activeVideo && !observedVideos.has(activeVideo)) {
    updatePlayBackSpeed(activeVideo);
  }
};

const forcePlaybackRate = (e: Event) => {
  if (e.target instanceof HTMLVideoElement) {
    const videoElement = e.target;
    if (videoElement.playbackRate !== speed()) {
      videoElement.playbackRate = speed();
    }
    if (
      currentConfig &&
      (videoElement as HTMLMediaElement & { preservesPitch?: boolean })
        .preservesPitch !== !currentConfig.noPreservesPitch
    ) {
      (
        videoElement as HTMLMediaElement & { preservesPitch?: boolean }
      ).preservesPitch = !currentConfig.noPreservesPitch;
    }
  }
};

const setActiveVideo = (e: Event) => {
  if (e.target instanceof HTMLVideoElement) {
    activeVideo = e.target;
    updatePlayBackSpeed(activeVideo);
  }
};

const [speed, setSpeed] = createSignal(1);
const sliderContainer = document.createElement('div');

const updatePlayBackSpeed = (videoElement = activeVideo) => {
  if (videoElement) {
    videoElement.playbackRate = speed();
    if (currentConfig) {
      (
        videoElement as HTMLMediaElement & { preservesPitch?: boolean }
      ).preservesPitch = !currentConfig.noPreservesPitch;
    }
  }

  setSpeed(speed());
};

let persistTimer: ReturnType<typeof setTimeout> | undefined;
const persistSpeed = () => {
  const context = currentContext;
  if (!context) return;

  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    Promise.resolve(context.setConfig({ playbackSpeed: speed() })).catch(
      console.error,
    );
  }, 300);
};

export const onPlayerApiReady = async (
  _api: unknown,
  context: RendererContext<PlaybackSpeedConfig>,
) => {
  currentContext = context;

  const observePopupContainer = () => {
    disposeSlider?.();
    disposeSlider = render(
      () => (
        <PlaybackSpeedSlider
          onImmediateValueChanged={(e) => {
            let targetSpeed = Number(e.detail.value ?? MIN_PLAYBACK_SPEED);

            if (isNaN(targetSpeed)) {
              targetSpeed = 1;
            }

            setSpeed(normalizePlaybackSpeed(targetSpeed));
            updatePlayBackSpeed();
            persistSpeed();
          }}
          onWheel={(e) => {
            e.preventDefault();

            if (isNaN(speed())) {
              setSpeed(1);
            }

            setSpeed(
              normalizePlaybackSpeed(
                Math.min(
                  Math.max(
                    speed() + (e.deltaY < 0 ? 0.01 : -0.01),
                    MIN_PLAYBACK_SPEED,
                  ),
                  MAX_PLAYBACK_SPEED,
                ),
              ),
            );

            updatePlayBackSpeed();
            persistSpeed();
          }}
          speed={speed()}
          title={t('plugins.playback-speed.templates.button')}
        />
      ),
      sliderContainer,
    );

    const syncSlider = () => {
      const menu = getSongMenu();

      if (
        menu &&
        !menu.contains(sliderContainer) &&
        isMusicOrVideoTrack() &&
        isPlayerMenu(menu)
      ) {
        menu.prepend(sliderContainer);
      }
    };

    const watchPopup = () => {
      unwatchPopup = observePlayerPage('ytmusic-popup-container', {
        childList: true,
        subtree: true,
        callback: syncSlider,
      });
    };

    unwatchPopup?.();
    unwatchPopup = null;

    // HACK: the popup container can be created after the player API is ready,
    // and the shared observer is a no-op until its root exists.
    if (document.querySelector('ytmusic-popup-container')) {
      watchPopup();
      return;
    }

    const popupObserver = new MutationObserver(() => {
      if (!document.querySelector('ytmusic-popup-container')) return;
      popupObserver.disconnect();
      watchPopup();
    });
    popupObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    unwatchPopup = () => popupObserver.disconnect();
  };

  const observeVideo = () => {
    const applyVideoEvents = (video: HTMLVideoElement) => {
      observedVideos.add(video);
      if (!activeVideo || (!video.paused && !video.ended)) {
        activeVideo = video;
      }
      updatePlayBackSpeed(video);
      video.addEventListener('playing', setActiveVideo);
      video.addEventListener('ratechange', forcePlaybackRate);
      video.addEventListener('peard:src-changed', forcePlaybackRate);
    };

    const video = document.querySelector<HTMLVideoElement>('video');
    if (video) {
      applyVideoEvents(video);
      video.dataset.playbackSpeedObserved = 'true';
    }

    unwatchVideo?.();
    unwatchVideo = observePlayerPage('#movie_player', {
      childList: true,
      subtree: true,
      callback: () => {
        document.querySelectorAll<HTMLVideoElement>('video').forEach((v) => {
          if (!v.dataset.playbackSpeedObserved) {
            v.dataset.playbackSpeedObserved = 'true';
            applyVideoEvents(v);
          }
        });
      },
    });
  };

  await startupLifecycle.initialize(context.getConfig, (config) => {
    untrack(() => {
      currentConfig = config;
      setSpeed(normalizePlaybackSpeed(config.playbackSpeed));
      observePopupContainer();
      observeVideo();
    });
  });
};

export const onUnload = () => {
  startupLifecycle.dispose();

  clearTimeout(persistTimer);
  persistTimer = undefined;
  currentContext = null;

  for (const video of observedVideos) {
    video.removeEventListener('playing', setActiveVideo);
    video.removeEventListener('ratechange', forcePlaybackRate);
    video.removeEventListener('peard:src-changed', forcePlaybackRate);
    delete video.dataset.playbackSpeedObserved;
  }
  observedVideos.clear();

  if (activeVideo) {
    activeVideo = null;
  }
  unwatchVideo?.();
  unwatchVideo = null;
  unwatchPopup?.();
  unwatchPopup = null;
  disposeSlider?.();
  disposeSlider = undefined;
  sliderContainer.remove();
};
