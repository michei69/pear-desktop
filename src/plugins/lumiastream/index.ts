import { net } from 'electron';

import { t } from '@/i18n';
import {
  registerCallback,
  SongInfoEvent,
  type SongInfoCallback,
  unregisterCallback,
} from '@/providers/song-info';
import { createPlugin } from '@/utils';

type LumiaData = {
  origin: string;
  eventType: string;
  url?: string;
  videoId?: string;
  playlistId?: string;
  cover?: string | null;
  cover_url?: string | null;
  title?: string;
  artists?: string[];
  status?: string;
  progress?: number;
  duration?: number;
  album_url?: string | null;
  album?: string | null;
  views?: number;
  isPaused?: boolean;
};

export default createPlugin<
  { callback: SongInfoCallback | null },
  unknown,
  unknown
>({
  name: () => t('plugins.lumiastream.name'),
  description: () => t('plugins.lumiastream.description'),
  restartNeeded: false,
  config: {
    enabled: false,
  },
  backend: {
    callback: null,
    start() {
      const secToMilisec = (seconds?: number) =>
        seconds ? Math.round(Number(seconds) * 1e3) : undefined;
      let previousStatePaused: boolean | null = null;
      let previousVideoId: string | undefined;

      const data: LumiaData = {
        origin:
          '\u0079\u006f\u0075\u0074\u0075\u0062\u0065\u006d\u0075\u0073\u0069\u0063',
        eventType: 'switchSong',
      };

      const post = (payload: LumiaData) => {
        const port = 39231;
        const headers = {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Origin': '*',
        } as const;
        const url = `http://127.0.0.1:${port}/api/media`;

        net
          .fetch(url, {
            method: 'POST',
            body: JSON.stringify({ token: 'lsmedia_ytmsI7812', data: payload }),
            headers,
          })
          .catch((error: { code: number; errno: number }) => {
            console.log(
              `Error: '${
                error.code || error.errno
              }' - when trying to access lumiastream webserver at port ${port}`,
            );
          });
      };

      const callback: SongInfoCallback = (songInfo, event) => {
        if (event === SongInfoEvent.TimeChanged) {
          return;
        }

        if (!songInfo.title && !songInfo.artist) {
          return;
        }

        const isPaused = songInfo.isPaused ?? false;
        const songChanged =
          previousVideoId !== undefined && songInfo.videoId !== previousVideoId;

        if (previousStatePaused === null || songChanged) {
          data.eventType = 'switchSong';
        } else if (previousStatePaused !== isPaused) {
          data.eventType = 'playPause';
        }

        data.duration = secToMilisec(songInfo.songDuration);
        data.progress = secToMilisec(songInfo.elapsedSeconds);
        data.url = songInfo.url;
        data.videoId = songInfo.videoId;
        data.playlistId = songInfo.playlistId;
        data.cover = songInfo.imageSrc;
        data.cover_url = songInfo.imageSrc;
        data.album_url = songInfo.imageSrc;
        data.title = songInfo.title;
        data.artists = [songInfo.artist];
        data.status = isPaused ? 'stopped' : 'playing';
        data.isPaused = isPaused;
        data.album = songInfo.album;
        data.views = songInfo.views;
        post(data);

        previousStatePaused = isPaused;
        previousVideoId = songInfo.videoId;
      };

      this.callback = callback;
      registerCallback(callback);
    },
    stop() {
      if (this.callback) {
        unregisterCallback(this.callback);
        this.callback = null;
      }
    },
  },
});
