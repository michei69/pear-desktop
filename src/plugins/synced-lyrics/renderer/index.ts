import { createRenderer } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

import { selectors, tabStates } from './utils';
import { setConfig, setCurrentTime } from './renderer';
import { refreshCurrentLyrics } from './store';
import { setTranslationDebugSender, translationDebug } from './debug';

import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';
import type { SongInfo } from '@/providers/song-info';
import type {
  SyncedLyricsPluginConfig,
  TranslationProviderName,
  TranslationProviderSettings,
} from '../types';
import type { TranslationRequest } from '../translation/types';

export let _ytAPI: MusicPlayer | null = null;
export let netFetch: (
  url: string,
  init?: RequestInit,
) => Promise<[number, string, Record<string, string>]>;

export interface TranslateInvokeArgs {
  videoId: string;
  request: TranslationRequest;
  provider: TranslationProviderName;
  settings: TranslationProviderSettings[TranslationProviderName];
}

export let translateInvoke: (
  args: TranslateInvokeArgs,
) => Promise<{ lines: string[]; fromCache: boolean; error?: string }>;

export const renderer = createRenderer<
  {
    observerCallback: MutationCallback;
    observer?: MutationObserver;
    videoDataChange: () => Promise<void>;
    updateTimestampInterval?: NodeJS.Timeout | string | number;
    videoDataDocumentListener?: EventListener;
  },
  SyncedLyricsPluginConfig
>({
  onConfigChange(newConfig) {
    setConfig(newConfig);
    refreshCurrentLyrics('config-change');
  },

  observerCallback(mutations: MutationRecord[]) {
    for (const mutation of mutations) {
      const header = mutation.target as HTMLElement;

      switch (mutation.attributeName) {
        case 'disabled':
          header.removeAttribute('disabled');
          break;
        case 'aria-selected':
          tabStates[header.ariaSelected ?? 'false']();
          break;
      }
    }
  },

  async onPlayerApiReady(api: MusicPlayer) {
    _ytAPI = api;

    api.addEventListener('videodatachange', this.videoDataChange);

    await this.videoDataChange();
    refreshCurrentLyrics('player-api-ready');
  },
  async videoDataChange() {
    if (!this.updateTimestampInterval) {
      this.updateTimestampInterval = setInterval(
        () => setCurrentTime((_ytAPI?.getCurrentTime() ?? 0) * 1000),
        100,
      );
    }

    // prettier-ignore
    this.observer ??= new MutationObserver(this.observerCallback);
    this.observer.disconnect();

    // Force the lyrics tab to be enabled at all times.
    const header = await waitForElement<HTMLElement>(selectors.head);
    {
      header.removeAttribute('disabled');
      tabStates[header.ariaSelected ?? 'false']();
    }

    this.observer.observe(header, { attributes: true });
    header.removeAttribute('disabled');
  },

  async start(ctx: RendererContext<SyncedLyricsPluginConfig>) {
    netFetch = ctx.ipc.invoke.bind(ctx.ipc, 'synced-lyrics:fetch');
    translateInvoke = ctx.ipc.invoke.bind(
      ctx.ipc,
      'synced-lyrics:translate',
    ) as typeof translateInvoke;
    setTranslationDebugSender((message, data) => {
      ctx.ipc.send('synced-lyrics:translation-debug', message, data);
    });

    setConfig(await ctx.getConfig());
    refreshCurrentLyrics('renderer-start');
    setTimeout(() => refreshCurrentLyrics('renderer-start-delayed'), 1500);

    ctx.ipc.on('peard:update-song-info', (info: SongInfo) => {
      translationDebug('song-info update', {
        videoId: info.videoId,
        title: info.title,
      });
      refreshCurrentLyrics('song-info-update', info);
    });

    this.videoDataDocumentListener = () => {
      setTimeout(() => refreshCurrentLyrics('document-videodatachange'), 0);
    };
    document.addEventListener(
      'videodatachange',
      this.videoDataDocumentListener,
    );
  },

  stop() {
    if (this.updateTimestampInterval) {
      clearInterval(this.updateTimestampInterval);
      this.updateTimestampInterval = undefined;
    }
    this.observer?.disconnect();
    _ytAPI?.removeEventListener('videodatachange', this.videoDataChange);

    if (this.videoDataDocumentListener) {
      document.removeEventListener(
        'videodatachange',
        this.videoDataDocumentListener,
      );
      this.videoDataDocumentListener = undefined;
    }
  },
});
