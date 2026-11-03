import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';

import { t } from '@/i18n';
import { type MenuTemplate } from '@/menu';
import { moveVolumeHud as preciseVolumeMoveVolumeHud } from '@/plugins/precise-volume/renderer';
import { observePlayerPage } from '@/providers/player-page-observer';
import { type ThumbnailElement } from '@/types/get-player-response';
import { createPlugin } from '@/utils';

import buttonSwitcherStyle from './button-switcher.css?inline';
import forceHideStyle from './force-hide.css?inline';
import { VideoSwitchButton } from './templates/video-switch-button';

export type VideoTogglePluginConfig = {
  enabled: boolean;
  hideVideo: boolean;
  mode: 'custom' | 'native' | 'disabled';
  forceHide: boolean;
  align: 'left' | 'middle' | 'right';
};

type OwnedAttributes = Map<string, string | null>;

/**
 * Records the YTM-owned page state the plugin overwrites, so disabling can put
 * every attribute/style back. Only the value found before the plugin's first
 * write to a property is kept; later writes are the plugin's own values.
 */
class PageStateTracker {
  private readonly attributes = new Map<Element, OwnedAttributes>();
  private readonly styles = new Map<HTMLElement, Map<string, string>>();

  setAttribute(element: Element, name: string, value: string) {
    this.rememberAttribute(element, name);
    element.setAttribute(name, value);
  }

  removeAttribute(element: Element, name: string) {
    this.rememberAttribute(element, name);
    element.removeAttribute(name);
  }

  setStyle(element: HTMLElement, property: string, value: string) {
    const owned = this.styles.get(element) ?? new Map<string, string>();
    if (!owned.has(property)) {
      owned.set(property, element.style.getPropertyValue(property));
      this.styles.set(element, owned);
    }
    element.style.setProperty(property, value);
  }

  restore() {
    for (const [element, owned] of this.attributes) {
      for (const [name, previous] of owned) {
        if (previous === null) {
          element.removeAttribute(name);
        } else {
          element.setAttribute(name, previous);
        }
      }
    }
    this.attributes.clear();

    for (const [element, owned] of this.styles) {
      for (const [property, previous] of owned) {
        if (previous === '') {
          element.style.removeProperty(property);
        } else {
          element.style.setProperty(property, previous);
        }
      }
    }
    this.styles.clear();
  }

  private rememberAttribute(element: Element, name: string) {
    const owned =
      this.attributes.get(element) ?? new Map<string, string | null>();
    if (owned.has(name)) {
      return;
    }
    owned.set(name, element.getAttribute(name));
    this.attributes.set(element, owned);
  }
}

type VideoToggleRenderer = {
  config: VideoTogglePluginConfig | null;
  audioOnlyEnabled: boolean;
  disposeRoot: (() => void) | null;
  switchButtonContainer: HTMLDivElement | null;
  videoElement: HTMLVideoElement | null;
  srcChangedHandler: (() => void) | null;
  observers: MutationObserver[];
  unwatchPlaybackMode: (() => void) | null;
  startTimeout: NodeJS.Timeout | null;
  generation: number;
  pageState: PageStateTracker;
  applyStyleClass(config: VideoTogglePluginConfig): void;
  dispose(): void;
};

export default createPlugin<
  unknown,
  unknown,
  VideoToggleRenderer,
  VideoTogglePluginConfig
>({
  name: () => t('plugins.video-toggle.name'),
  description: () => t('plugins.video-toggle.description'),
  config: {
    enabled: false,
    hideVideo: false,
    mode: 'custom',
    forceHide: false,
    align: 'left',
  } as VideoTogglePluginConfig,
  settings: [
    {
      type: 'select',
      key: 'mode',
      label: () => t('plugins.video-toggle.menu.mode.label'),
      // Applied on renderer start, not on config change.
      restartNeeded: true,
      options: [
        {
          value: 'custom',
          label: () => t('plugins.video-toggle.menu.mode.submenu.custom'),
        },
        {
          value: 'native',
          label: () => t('plugins.video-toggle.menu.mode.submenu.native'),
        },
        {
          value: 'disabled',
          label: () => t('plugins.video-toggle.menu.mode.submenu.disabled'),
        },
      ],
    },
    {
      type: 'select',
      key: 'align',
      label: () => t('plugins.video-toggle.menu.align.label'),
      restartNeeded: true,
      options: [
        {
          value: 'left',
          label: () => t('plugins.video-toggle.menu.align.submenu.left'),
        },
        {
          value: 'middle',
          label: () => t('plugins.video-toggle.menu.align.submenu.middle'),
        },
        {
          value: 'right',
          label: () => t('plugins.video-toggle.menu.align.submenu.right'),
        },
      ],
    },
    {
      type: 'switch',
      key: 'forceHide',
      label: () => t('plugins.video-toggle.menu.force-hide'),
    },
  ],
  stylesheets: [buttonSwitcherStyle, forceHideStyle],
  menu: async ({ getConfig, setConfig }): Promise<MenuTemplate> => {
    const config = await getConfig();

    return [
      {
        label: t('plugins.video-toggle.menu.mode.label'),
        submenu: [
          {
            label: t('plugins.video-toggle.menu.mode.submenu.custom'),
            type: 'radio',
            checked: config.mode === 'custom',
            click() {
              setConfig({ mode: 'custom' });
            },
          },
          {
            label: t('plugins.video-toggle.menu.mode.submenu.native'),
            type: 'radio',
            checked: config.mode === 'native',
            click() {
              setConfig({ mode: 'native' });
            },
          },
          {
            label: t('plugins.video-toggle.menu.mode.submenu.disabled'),
            type: 'radio',
            checked: config.mode === 'disabled',
            click() {
              setConfig({ mode: 'disabled' });
            },
          },
        ],
      },
      {
        label: t('plugins.video-toggle.menu.align.label'),
        submenu: [
          {
            label: t('plugins.video-toggle.menu.align.submenu.left'),
            type: 'radio',
            checked: config.align === 'left',
            click() {
              setConfig({ align: 'left' });
            },
          },
          {
            label: t('plugins.video-toggle.menu.align.submenu.middle'),
            type: 'radio',
            checked: config.align === 'middle',
            click() {
              setConfig({ align: 'middle' });
            },
          },
          {
            label: t('plugins.video-toggle.menu.align.submenu.right'),
            type: 'radio',
            checked: config.align === 'right',
            click() {
              setConfig({ align: 'right' });
            },
          },
        ],
      },
      {
        label: t('plugins.video-toggle.menu.force-hide'),
        type: 'checkbox',
        checked: config.forceHide,
        click(item) {
          setConfig({ forceHide: item.checked });
        },
      },
    ];
  },

  renderer: {
    config: null as VideoTogglePluginConfig | null,
    /** audio-only owns ATV_PREFERRED while it runs; see setVideoState. */
    audioOnlyEnabled: false,
    disposeRoot: null as (() => void) | null,
    switchButtonContainer: null as HTMLDivElement | null,
    videoElement: null as HTMLVideoElement | null,
    srcChangedHandler: null as (() => void) | null,
    observers: [] as MutationObserver[],
    unwatchPlaybackMode: null as (() => void) | null,
    startTimeout: null as NodeJS.Timeout | null,
    generation: 0,
    pageState: new PageStateTracker(),
    applyStyleClass: (config: VideoTogglePluginConfig) => {
      const customMode = !config.forceHide && config.mode === 'custom';
      document.body.classList.toggle(
        'video-toggle-force-hide',
        config.forceHide,
      );
      document.body.classList.toggle('video-toggle-custom-mode', customMode);
    },
    async start({ getConfig }) {
      const generation = ++this.generation;
      const config = await getConfig();
      if (generation !== this.generation) return;
      this.applyStyleClass(config);

      if (config.forceHide) {
        return;
      }

      switch (config.mode) {
        case 'native': {
          const playerPage = document.querySelector('ytmusic-player-page');
          if (playerPage) {
            this.pageState.setAttribute(playerPage, 'has-av-switcher', '');
          }
          const player = document.querySelector('ytmusic-player');
          if (player) {
            this.pageState.setAttribute(player, 'has-av-switcher', '');
          }
          const avToggle = document.querySelector('ytmusic-av-toggle');
          if (avToggle) {
            this.pageState.removeAttribute(avToggle, 'toggle-disabled');
          }
          return;
        }

        case 'disabled': {
          const playerPage = document.querySelector('ytmusic-player-page');
          if (playerPage) {
            this.pageState.removeAttribute(playerPage, 'has-av-switcher');
          }
          const player = document.querySelector('ytmusic-player');
          if (player) {
            this.pageState.removeAttribute(player, 'has-av-switcher');
          }
          const avToggle = document.querySelector('ytmusic-av-toggle');
          if (avToggle) {
            this.pageState.setAttribute(avToggle, 'toggle-disabled', '');
          }
          return;
        }
      }
    },
    async onPlayerApiReady(api, { getConfig }) {
      this.dispose();
      const generation = ++this.generation;
      const [showButton, setShowButton] = createSignal(true);

      const config = await getConfig();
      this.config = config;

      this.audioOnlyEnabled =
        await window.mainConfig.plugins.isEnabled('audio-only');
      if (generation !== this.generation) return;

      const moveVolumeHud = (await window.mainConfig.plugins.isEnabled(
        'precise-volume',
      ))
        ? (preciseVolumeMoveVolumeHud as (_: boolean) => void)
        : () => {};
      if (generation !== this.generation) return;

      const player = document.querySelector<
        HTMLElement & { videoMode_: boolean }
      >('ytmusic-player');
      const video = document.querySelector<HTMLVideoElement>('video');

      const switchButtonContainer = document.createElement('div');
      switchButtonContainer.id = 'ytmd-video-toggle-switch-button-container';
      switchButtonContainer.style.display = 'flex';
      this.switchButtonContainer = switchButtonContainer;
      this.disposeRoot = render(
        () => (
          <Show when={showButton()}>
            <VideoSwitchButton
              onChange={(e) => {
                const target = e.target as HTMLInputElement;

                setVideoState(target.checked);
              }}
              onClick={(e) => e.stopPropagation()}
              songButtonText={t('plugins.video-toggle.templates.button-song')}
              videoButtonText={t('plugins.video-toggle.templates.button-video')}
            />
          </Show>
        ),
        switchButtonContainer,
      );

      const forceThumbnail = (img: HTMLImageElement) => {
        const thumbnails: ThumbnailElement[] =
          api?.getPlayerResponse()?.videoDetails?.thumbnail?.thumbnails ?? [];
        if (thumbnails && thumbnails.length > 0) {
          const thumbnail = thumbnails.at(-1)?.url.split('?')[0];
          if (thumbnail) img.src = thumbnail;
        }
      };

      const setVideoState = (showVideo: boolean) => {
        // Runs on every track change, so only persist an actual difference.
        const hideVideo = !showVideo;
        if (this.config && this.config.hideVideo !== hideVideo) {
          this.config.hideVideo = hideVideo;
          window.mainConfig.plugins.setOptions('video-toggle', this.config);
        }

        const checkbox = document.querySelector<HTMLInputElement>(
          '.video-switch-button-checkbox',
        ); // custom mode
        if (checkbox) checkbox.checked = !this.config?.hideVideo;

        if (player) {
          this.pageState.setStyle(
            player,
            'margin',
            showVideo ? '' : 'auto 0px',
          );
          // audio-only asserts ATV_PREFERRED from its own persistent observer,
          // so writing that value here is duplicated work. Its non-ATV
          // behavior (the OMV write when video is shown) is unchanged.
          if (showVideo || !this.audioOnlyEnabled) {
            this.pageState.setAttribute(
              player,
              'playback-mode',
              showVideo ? 'OMV_PREFERRED' : 'ATV_PREFERRED',
            );
          }

          const songVideo = document.querySelector<HTMLElement>(
            '#song-video.ytmusic-player',
          );
          const songImage = document.querySelector<HTMLElement>('#song-image');
          if (songVideo) {
            this.pageState.setStyle(
              songVideo,
              'display',
              showVideo ? 'block' : 'none',
            );
          }
          if (songImage) {
            this.pageState.setStyle(
              songImage,
              'display',
              showVideo ? 'none' : 'block',
            );
          }

          if (showVideo && video && !video.style.top) {
            this.pageState.setStyle(
              video,
              'top',
              `${(player.clientHeight - video.clientHeight) / 2}px`,
            );
          }

          moveVolumeHud(showVideo);
        }
      };

      const videoStarted = () => {
        if (
          api.getPlayerResponse()?.videoDetails?.musicVideoType ===
          'MUSIC_VIDEO_TYPE_ATV'
        ) {
          // No video: song mode, and nothing to toggle.
          setVideoState(false);
          setShowButton(false);
        } else {
          const songImage = document.querySelector<HTMLImageElement>(
            '#song-image #img.style-scope.yt-img-shadow',
          );
          if (!songImage) {
            return;
          }
          forceThumbnail(songImage);
          setShowButton(true);
          // Start in video mode if a hidden video exists and it is not disabled.
          if (
            !this.config?.hideVideo &&
            document.querySelector<HTMLElement>('#song-video.ytmusic-player')
              ?.style.display === 'none'
          ) {
            setVideoState(true);
          } else {
            moveVolumeHud(!this.config?.hideVideo);
          }
        }
      };

      // HACK: after load, the page forces playback-mode to 'OMV_PREFERRED',
      // which wrecks the image container's aspect ratio. Override the override.
      const forcePlaybackMode = () => {
        if (!player) return;
        this.unwatchPlaybackMode = observePlayerPage('ytmusic-player', {
          attributes: ['playback-mode'],
          callback: (mutations) => {
            for (const mutation of mutations) {
              if (!(mutation.target instanceof HTMLElement)) continue;
              if (
                mutation.target.getAttribute('playback-mode') !==
                'ATV_PREFERRED'
              ) {
                this.unwatchPlaybackMode?.();
                this.unwatchPlaybackMode = null;
                this.pageState.setAttribute(
                  mutation.target,
                  'playback-mode',
                  'ATV_PREFERRED',
                );
                return;
              }
            }
          },
        });
      };

      const observeThumbnail = () => {
        const playbackModeObserver = new MutationObserver((mutations) => {
          if (!player?.videoMode_) {
            return;
          }

          for (const mutation of mutations) {
            if (mutation.target instanceof HTMLImageElement) {
              const target = mutation.target;
              if (!target.src.startsWith('data:')) {
                continue;
              }

              forceThumbnail(target);
            }
          }
        });
        const thumbnail = document.querySelector(
          '#song-image #img.style-scope.yt-img-shadow',
        );
        if (!thumbnail) return;
        playbackModeObserver.observe(thumbnail, {
          attributeFilter: ['src'],
        });
        this.observers.push(playbackModeObserver);
      };

      if (config.mode !== 'native' && config.mode != 'disabled') {
        this.startTimeout = setTimeout(() => {
          this.startTimeout = null;
          const playerSelector =
            document.querySelector<HTMLVideoElement>('#player');
          if (!playerSelector) return;

          playerSelector.prepend(switchButtonContainer);
          setVideoState(!config.hideVideo);
          // audio-only's observer already holds ATV_PREFERRED; adding ours
          // would be a second owner of the same attribute.
          if (!this.audioOnlyEnabled) forcePlaybackMode();
          if (video) {
            this.pageState.setStyle(video, 'height', 'auto');
            this.videoElement = video;
            this.srcChangedHandler = videoStarted;
            video.addEventListener('peard:src-changed', videoStarted);
          }
          observeThumbnail();
          videoStarted();
          switch (config.align) {
            case 'right': {
              switchButtonContainer.style.justifyContent = 'flex-end';
              return;
            }

            case 'middle': {
              switchButtonContainer.style.justifyContent = 'center';
              return;
            }

            default:
            case 'left': {
              switchButtonContainer.style.justifyContent = 'flex-start';
            }
          }
        }, 0);
      }
    },
    dispose() {
      if (this.startTimeout) {
        clearTimeout(this.startTimeout);
        this.startTimeout = null;
      }

      for (const observer of this.observers) {
        observer.disconnect();
      }
      this.observers = [];

      this.unwatchPlaybackMode?.();
      this.unwatchPlaybackMode = null;

      if (this.videoElement && this.srcChangedHandler) {
        this.videoElement.removeEventListener(
          'peard:src-changed',
          this.srcChangedHandler,
        );
      }
      this.videoElement = null;
      this.srcChangedHandler = null;

      this.disposeRoot?.();
      this.disposeRoot = null;

      this.switchButtonContainer?.remove();
      this.switchButtonContainer = null;
    },
    stop() {
      this.generation++;
      this.dispose();
      this.pageState.restore();

      document.body.classList.remove(
        'video-toggle-custom-mode',
        'video-toggle-force-hide',
      );
    },
    onConfigChange(newConfig) {
      this.config = newConfig;
      this.applyStyleClass(newConfig);
    },
  },
});
