import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';

import { t } from '@/i18n';
import { observePlayerPage } from '@/providers/player-page-observer';
import { createRenderer } from '@/utils';

import { CaptionsSettingButton } from './templates/captions-settings-template';

import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';
import type { AppElement } from '@/types/queue';

export interface LanguageOptions {
  displayName: string;
  id: string | null;
  is_default: boolean;
  is_servable: boolean;
  is_translateable: boolean;
  kind: string;
  languageCode: string; // 2 length
  languageName: string;
  name: string | null;
  vss_id: string;
}

export interface CaptionsSelectorConfig {
  enabled: boolean;
  disableCaptions: boolean;
  autoload: boolean;
  lastCaptionsCode: string;
}

const [hidden, setHidden] = createSignal(false);

export default createRenderer<
  {
    captionTrackList: LanguageOptions[] | null;
    api: MusicPlayer | null;
    config: CaptionsSelectorConfig | null;
    videoChangeListener: () => void;
    video: HTMLVideoElement | null;
    controls: HTMLElement | null;
    dispose: (() => void) | null;
    trackListTimer: ReturnType<typeof setTimeout> | null;
    captionSwitchTimer: ReturnType<typeof setTimeout> | null;
    unwatchPlayer: (() => void) | null;
    rafId: number;
    ipc: RendererContext<CaptionsSelectorConfig>['ipc'] | null;
    setConfig: RendererContext<CaptionsSelectorConfig>['setConfig'] | null;
    sync(): void;
    chooseCaptions(): Promise<void>;
  },
  CaptionsSelectorConfig
>({
  captionTrackList: null,
  api: null,
  config: null,
  video: null,
  controls: null,
  dispose: null,
  trackListTimer: null,
  captionSwitchTimer: null,
  unwatchPlayer: null,
  rafId: 0,
  ipc: null,
  setConfig: null,
  videoChangeListener() {
    const api = this.api;
    if (!api) return;

    if (this.trackListTimer) {
      clearTimeout(this.trackListTimer);
      this.trackListTimer = null;
    }

    if (this.config?.disableCaptions) {
      this.trackListTimer = setTimeout(() => {
        this.trackListTimer = null;
        api.unloadModule('captions');
      }, 100);
      setHidden(true);
      return;
    }

    api.loadModule('captions');

    this.trackListTimer = setTimeout(() => {
      this.trackListTimer = null;
      this.captionTrackList =
        api.getOption<LanguageOptions[]>('captions', 'tracklist') ?? [];

      if (this.config?.autoload && this.config.lastCaptionsCode) {
        api.setOption('captions', 'track', {
          languageCode: this.config.lastCaptionsCode,
        });
      }

      setHidden(!this.captionTrackList.length);
    }, 250);
  },
  async chooseCaptions() {
    const api = this.api;
    const ipc = this.ipc;
    const setConfig = this.setConfig;
    if (!api || !ipc || !setConfig) return;

    const appApi = document.querySelector<AppElement>('ytmusic-app');

    if (!this.captionTrackList?.length) {
      appApi?.toastService?.show(
        t('plugins.captions-selector.toast.no-captions'),
      );
      return;
    }

    const currentCaptionTrack = api.getOption<LanguageOptions>(
      'captions',
      'track',
    );

    let currentIndex = currentCaptionTrack
      ? this.captionTrackList.indexOf(
          this.captionTrackList.find(
            (track) => track.languageCode === currentCaptionTrack.languageCode,
          )!,
        )
      : null;

    const captionLabels = [
      ...this.captionTrackList.map((track) => track.displayName),
      t('plugins.captions-selector.prompt.selector.none'),
    ];

    const selected = (await ipc.invoke(
      'peard:captions-selector',
      captionLabels,
      currentIndex,
    )) as string | number | null;
    if (selected === null || selected === undefined) {
      return;
    }

    currentIndex = Number(selected);
    const newCaptions = this.captionTrackList[currentIndex];
    if (newCaptions) {
      setConfig({ lastCaptionsCode: newCaptions.languageCode });
      api.setOption('captions', 'track', {
        languageCode: newCaptions.languageCode,
      });
      appApi?.toastService?.show(
        t('plugins.captions-selector.toast.caption-changed', {
          language: newCaptions.displayName,
        }),
      );
    } else {
      api.setOption('captions', 'track', {});
      appApi?.toastService?.show(
        t('plugins.captions-selector.toast.caption-disabled'),
      );
    }

    if (this.captionSwitchTimer) {
      clearTimeout(this.captionSwitchTimer);
    }
    this.captionSwitchTimer = setTimeout(() => {
      this.captionSwitchTimer = null;
      if (this.api?.getPlayerState() === 1) this.api.playVideo();
    });
  },
  sync() {
    const controls = document.querySelector<HTMLElement>(
      '.right-controls-buttons',
    );
    if (!controls || !this.ipc || !this.setConfig) return;
    if (this.controls === controls && this.dispose) return;

    this.dispose?.();
    this.dispose = null;
    controls
      .querySelectorAll('.player-captions-button')
      .forEach((element) => element.remove());
    this.controls = controls;

    this.dispose = render(
      () => (
        <Show when={!hidden()}>
          <CaptionsSettingButton
            label={t('plugins.captions-selector.templates.title')}
            onClick={() => {
              this.chooseCaptions().catch(() => {});
            }}
          />
        </Show>
      ),
      controls,
    );
  },
  async start({ getConfig }) {
    this.config = await getConfig();
  },
  stop() {
    if (this.trackListTimer) {
      clearTimeout(this.trackListTimer);
      this.trackListTimer = null;
    }
    if (this.captionSwitchTimer) {
      clearTimeout(this.captionSwitchTimer);
      this.captionSwitchTimer = null;
    }

    this.unwatchPlayer?.();
    this.unwatchPlayer = null;
    cancelAnimationFrame(this.rafId);

    this.dispose?.();
    this.dispose = null;
    document
      .querySelectorAll('.player-captions-button')
      .forEach((element) => element.remove());
    this.controls = null;

    this.api?.unloadModule('captions');
    this.video?.removeEventListener(
      'peard:src-changed',
      this.videoChangeListener,
    );
    this.video = null;
    this.api = null;
    this.ipc = null;
    this.setConfig = null;
    this.captionTrackList = null;
    setHidden(true);
  },
  onPlayerApiReady(playerApi, context) {
    this.api = playerApi;
    this.ipc = context.ipc;
    this.setConfig = context.setConfig;

    this.captionTrackList =
      playerApi.getOption<LanguageOptions[]>('captions', 'tracklist') ?? [];
    setHidden(!this.captionTrackList.length);

    if (this.config?.disableCaptions) {
      playerApi.unloadModule('captions');
      setHidden(true);
    }

    this.unwatchPlayer?.();
    this.unwatchPlayer = observePlayerPage(
      document.querySelector('ytmusic-app-layout')
        ? 'ytmusic-app-layout'
        : 'body',
      {
        childList: true,
        subtree: true,
        callback: () => {
          cancelAnimationFrame(this.rafId);
          this.rafId = requestAnimationFrame(() => this.sync());
        },
      },
    );

    this.sync();

    const video = document.querySelector<HTMLVideoElement>('video');
    if (video) {
      this.video?.removeEventListener(
        'peard:src-changed',
        this.videoChangeListener,
      );
      this.video = video;
      video.addEventListener('peard:src-changed', this.videoChangeListener);
    }
  },
  onConfigChange(newConfig) {
    this.config = newConfig;
  },
});
