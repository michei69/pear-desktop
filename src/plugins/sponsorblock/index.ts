import is from 'electron-is';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { sortSegments } from './segments';

import type { Segment, SkipSegment } from './types';
import type { GetPlayerResponse } from '@/types/get-player-response';

export type SponsorBlockPluginConfig = {
  enabled: boolean;
  apiURL: string;
  categories: (
    | 'sponsor'
    | 'intro'
    | 'outro'
    | 'interaction'
    | 'selfpromo'
    | 'music_offtopic'
  )[];
};

let currentSegments: Segment[] = [];

export default createPlugin({
  name: () => t('plugins.sponsorblock.name'),
  description: () => t('plugins.sponsorblock.description'),
  restartNeeded: true,
  config: {
    enabled: false,
    apiURL: 'https://sponsor.ajay.app',
    categories: [
      'sponsor',
      'intro',
      'outro',
      'interaction',
      'selfpromo',
      'music_offtopic',
    ],
  } as SponsorBlockPluginConfig,
  settings: [
    {
      type: 'multiselect',
      key: 'categories',
      label: () => t('plugins.sponsorblock.settings.categories'),
      // Read by the backend on start; it has no onConfigChange.
      restartNeeded: true,
      options: [
        {
          value: 'sponsor',
          label: () => t('plugins.sponsorblock.settings.category.sponsor'),
        },
        {
          value: 'intro',
          label: () => t('plugins.sponsorblock.settings.category.intro'),
        },
        {
          value: 'outro',
          label: () => t('plugins.sponsorblock.settings.category.outro'),
        },
        {
          value: 'interaction',
          label: () => t('plugins.sponsorblock.settings.category.interaction'),
        },
        {
          value: 'selfpromo',
          label: () => t('plugins.sponsorblock.settings.category.selfpromo'),
        },
        {
          value: 'music_offtopic',
          label: () =>
            t('plugins.sponsorblock.settings.category.music_offtopic'),
        },
      ],
    },
    {
      type: 'text',
      key: 'apiURL',
      label: () => t('plugins.sponsorblock.settings.api-url'),
      placeholder: () => 'https://sponsor.ajay.app',
      restartNeeded: true,
    },
  ],
  backend: {
    async start({ getConfig, ipc }) {
      const fetchSegments = async (
        apiURL: string,
        categories: string[],
        videoId: string,
      ) => {
        const sponsorBlockURL = `${apiURL}/api/skipSegments?videoID=${videoId}&categories=${JSON.stringify(
          categories,
        )}`;
        try {
          const resp = await fetch(sponsorBlockURL, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
            redirect: 'follow',
          });
          if (resp.status !== 200) {
            return [];
          }

          const segments = (await resp.json()) as SkipSegment[];
          return sortSegments(segments.map((submission) => submission.segment));
        } catch (error) {
          if (is.dev()) {
            console.log('error on sponsorblock request:', error);
          }

          return [];
        }
      };

      const config = await getConfig();

      const { apiURL, categories } = config;

      const handleVideoSrcChanged = async (data: GetPlayerResponse) => {
        const segments = await fetchSegments(
          apiURL,
          categories,
          data?.videoDetails?.videoId,
        );
        ipc.send('sponsorblock-skip', segments);
      };

      ipc.on('peard:video-src-changed', handleVideoSrcChanged);
    },
    stop({ ipc }) {
      ipc.removeAllListeners('peard:video-src-changed');
    },
  },
  renderer: {
    timeUpdateListener: (e: Event) => {
      if (e.target instanceof HTMLVideoElement) {
        const target = e.target;
        const t = target.currentTime;

        // Binary search the sorted segments.
        let lo = 0;
        let hi = currentSegments.length - 1;
        let found = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >>> 1;
          if (t < currentSegments[mid][0]) {
            hi = mid - 1;
          } else if (t >= currentSegments[mid][1]) {
            lo = mid + 1;
          } else {
            found = mid;
            break;
          }
        }

        if (found !== -1) {
          target.currentTime = currentSegments[found][1];
          if (window.electronIs.dev()) {
            console.log(
              'SponsorBlock: skipping segment',
              currentSegments[found],
            );
          }
        }
      }
    },
    resetSegments: () => (currentSegments = []),
    start({ ipc }) {
      ipc.on('sponsorblock-skip', (segments: Segment[]) => {
        currentSegments = segments;
      });
    },
    onPlayerApiReady() {
      const video = document.querySelector<HTMLVideoElement>('video');
      if (!video) return;

      video.addEventListener('timeupdate', this.timeUpdateListener);
      // 'emptied' fires when the track ends
      video.addEventListener('emptied', this.resetSegments);
    },
    stop({ ipc }) {
      ipc.removeAllListeners('sponsorblock-skip');
      currentSegments = [];

      const video = document.querySelector<HTMLVideoElement>('video');
      if (!video) return;

      video.removeEventListener('timeupdate', this.timeUpdateListener);
      video.removeEventListener('emptied', this.resetSegments);
    },
  },
});
