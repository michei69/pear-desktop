import { serve } from '@hono/node-server';
import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { t } from 'i18next';

import {
  getCurrentSongInfo,
  registerCallback,
  unregisterCallback,
  type SongInfo,
} from '@/providers/song-info';
import {
  SONG_INFO_SETUP_CHANNEL,
  SongInfoEventFlag,
} from '@/types/song-info-events';
import { createBackend } from '@/utils';

import { formatSongInfo } from './format';

const amusePort = 9863;

export default createBackend({
  currentSongInfo: {} as SongInfo,
  isAdvertisement: false,
  positionUpdatedAt: 0,
  app: null as Hono | null,
  server: null as ReturnType<typeof serve> | null,
  adStateListener: null as ((isAd: boolean) => void) | null,
  playerApiLoadedListener: null as (() => void) | null,
  songInfoCallback: null as ((songInfo: SongInfo) => void) | null,

  start({ ipc }) {
    // The backend owns the advertisement mode served to clients; a re-enable
    // starts from "not an ad" until the renderer reports again.
    this.isAdvertisement = false;

    this.adStateListener = (isAd: boolean) => {
      this.isAdvertisement = isAd;
    };
    ipc.on('peard:amuse-ad-state', this.adStateListener);

    const requestTimeUpdates = () => {
      ipc.send(SONG_INFO_SETUP_CHANNEL, SongInfoEventFlag.TimeChanged);
    };
    this.playerApiLoadedListener = requestTimeUpdates;
    ipc.on('peard:player-api-loaded', this.playerApiLoadedListener);

    this.songInfoCallback = (songInfo) => {
      if (
        songInfo.elapsedSeconds !== this.currentSongInfo.elapsedSeconds ||
        songInfo.videoId !== this.currentSongInfo.videoId ||
        songInfo.isPaused !== this.currentSongInfo.isPaused
      ) {
        this.positionUpdatedAt = Date.now();
      }
      // HACK: the song-info provider reuses one object, keep a copy to compare
      this.currentSongInfo = { ...songInfo };
    };
    registerCallback(this.songInfoCallback);

    // A live enable happens after player-api-loaded already fired: arm time
    // updates now and replay the current song so /query is not empty until the
    // next track arrives.
    requestTimeUpdates();
    const current = getCurrentSongInfo();
    if (current) {
      this.currentSongInfo = { ...current };
      this.positionUpdatedAt = Date.now();
    }

    this.app = new Hono();
    this.app.use('*', cors());
    this.app.get('/', (ctx) =>
      ctx.body(t('plugins.amuse.response.query'), 200),
    );

    const queryAndApiHandler = (ctx: Context) => {
      return ctx.json(
        formatSongInfo(
          this.currentSongInfo,
          this.isAdvertisement,
          this.positionUpdatedAt,
        ),
        200,
      );
    };

    this.app.get('/query', queryAndApiHandler);
    this.app.get('/api', queryAndApiHandler);

    try {
      this.server = serve({
        fetch: this.app.fetch.bind(this.app),
        port: amusePort,
      });
    } catch (err) {
      console.error(err);
    }
  },

  stop({ ipc }) {
    if (this.adStateListener) {
      ipc.off('peard:amuse-ad-state', this.adStateListener);
      this.adStateListener = null;
    }
    if (this.playerApiLoadedListener) {
      ipc.off('peard:player-api-loaded', this.playerApiLoadedListener);
      this.playerApiLoadedListener = null;
    }
    if (this.songInfoCallback) {
      unregisterCallback(this.songInfoCallback);
      this.songInfoCallback = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.isAdvertisement = false;
  },
});
