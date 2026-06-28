import { getSongInfo } from '@/providers/song-info-front';
import { createRenderer } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

import { setTranslationDebugSender, translationDebug } from './debug';
import {
  netFetch,
  setNetFetch,
  setTranslateInvoke,
  translateInvoke,
} from './ipc-bridge';
import { disposeReactiveRoot } from './reactive-root';
import { setConfig, setCurrentTime } from './renderer';
import { refreshCurrentLyrics } from './store';
import { selectors, tabStates } from './utils';

import type { SyncedLyricsPluginConfig } from '../types';
import type { SongInfo } from '@/providers/song-info';
import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

export { netFetch, translateInvoke };

export let _ytAPI: MusicPlayer | null = null;

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

    const info = getSongInfo();
    if (info?.videoId) {
      refreshCurrentLyrics('player-api-ready');
    } else {
      // getSongInfo() may not have videoId yet if the peard:update-song-info
      // IPC roundtrip from the main process hasn't completed. Fall back to
      // reading directly from the player API so lyricsStore.videoId is set
      // immediately and the lyrics UI exits the loading state.
      const vd = api.getVideoData();
      refreshCurrentLyrics('player-api-ready', {
        ...info,
        videoId: vd.video_id,
        title: vd.title || info.title || '',
        artist: vd.author || info.artist || '',
        songDuration: api.getDuration() || info.songDuration || 0,
      } as SongInfo);
    }
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
    setNetFetch(ctx.ipc.invoke.bind(ctx.ipc, 'synced-lyrics:fetch'));
    setTranslateInvoke(
      ctx.ipc.invoke.bind(
        ctx.ipc,
        'synced-lyrics:translate',
      ) as typeof translateInvoke,
    );
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
    disposeReactiveRoot();
  },
});
