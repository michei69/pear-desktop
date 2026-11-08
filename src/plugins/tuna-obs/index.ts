import { net } from 'electron';
import is from 'electron-is';

import { t } from '@/i18n';
import {
  registerCallback,
  type SongInfoCallback,
  unregisterCallback,
} from '@/providers/song-info';
import {
  SONG_INFO_SETUP_CHANNEL,
  SongInfoEventFlag,
} from '@/types/song-info-events';
import { createPlugin } from '@/utils';

/** How long a failed probe suppresses payloads before the real POST is retried. */
const LITE_RETRY_MS = 30_000;

interface Data {
  album: string | null | undefined;
  album_url: string;
  artists: string[];
  cover: string;
  cover_url: string;
  duration: number;
  progress: number;
  status: string;
  title: string;
  alternativeTitle: string;
  url: string;
  tags: string[];
}

export default createPlugin<
  {
    liteMode: boolean;
    /** Set while lite mode waits to retry the real request. */
    liteRetryTimer: ReturnType<typeof setTimeout> | null;
    callback: SongInfoCallback | null;
    playerApiLoadedListener: (() => void) | null;
  },
  unknown,
  unknown
>({
  name: () => t('plugins.tuna-obs.name'),
  description: () => t('plugins.tuna-obs.description'),
  config: {
    enabled: false,
  },
  backend: {
    liteMode: false,
    liteRetryTimer: null,
    callback: null,
    playerApiLoadedListener: null,
    start({ ipc }) {
      const secToMilisec = (seconds: number) =>
        Math.round(Number(seconds) * 1e3);
      let lastPayload: Data | undefined;

      const post = (data: Data) => {
        lastPayload = data;
        const port = 1608;
        const headers = {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Origin': '*',
        };
        const url = `http://127.0.0.1:${port}/`;
        net
          .fetch(url, {
            method: this.liteMode ? 'OPTIONS' : 'POST',
            headers,
            keepalive: true,
            body: this.liteMode ? undefined : JSON.stringify({ data }),
          })
          .then(() => {
            if (this.liteRetryTimer) {
              clearTimeout(this.liteRetryTimer);
              this.liteRetryTimer = null;
            }
            if (this.liteMode) {
              this.liteMode = false;
              console.debug(
                `obs-tuna webserver at port ${port} is now accessible. disable lite mode`,
              );
              post(data);
            }
          })
          .catch((error: { code: number; errno: number }) => {
            if (!this.liteMode) {
              if (is.dev()) {
                console.debug(
                  `Error: '${
                    error.code || error.errno
                  }' - when trying to access obs-tuna webserver at port ${port}. enable lite mode`,
                );
              }
              this.liteMode = true;
            }

            // A probe that keeps failing must not latch the plugin in
            // empty-payload mode forever: retry the real request later, then
            // fall back to probing if it fails again.
            if (!this.liteRetryTimer) {
              this.liteRetryTimer = setTimeout(() => {
                this.liteRetryTimer = null;
                if (!this.callback) return;
                this.liteMode = false;
                if (lastPayload) post(lastPayload);
              }, LITE_RETRY_MS);
            }
          });
      };

      const requestTimeUpdates = () =>
        ipc.send(SONG_INFO_SETUP_CHANNEL, SongInfoEventFlag.TimeChanged);
      this.playerApiLoadedListener = requestTimeUpdates;
      ipc.on('peard:player-api-loaded', this.playerApiLoadedListener);

      // TimeChanged carries the elapsed time OBS renders as progress, so this
      // callback must run for it too.
      const callback: SongInfoCallback = (songInfo) => {
        if (!songInfo.title && !songInfo.artist) {
          return;
        }

        post({
          duration: secToMilisec(songInfo.songDuration),
          progress: secToMilisec(songInfo.elapsedSeconds ?? 0),
          cover: songInfo.imageSrc ?? '',
          cover_url: songInfo.imageSrc ?? '',
          album_url: songInfo.imageSrc ?? '',
          title: songInfo.title,
          alternativeTitle: songInfo.alternativeTitle ?? '',
          artists: [songInfo.artist],
          status: songInfo.isPaused ? 'stopped' : 'playing',
          album: songInfo.album,
          url: songInfo.url ?? '',
          tags: songInfo.tags ?? [],
        });
      };

      this.callback = callback;
      registerCallback(callback);

      // A live enable happens after player-api-loaded already fired, so request
      // the current time now instead of waiting for the next track.
      requestTimeUpdates();
    },
    stop({ ipc }) {
      if (this.callback) {
        unregisterCallback(this.callback);
        this.callback = null;
      }
      if (this.playerApiLoadedListener) {
        ipc.off('peard:player-api-loaded', this.playerApiLoadedListener);
        this.playerApiLoadedListener = null;
      }
      if (this.liteRetryTimer) {
        clearTimeout(this.liteRetryTimer);
        this.liteRetryTimer = null;
      }
      this.liteMode = false;
    },
  },
});
