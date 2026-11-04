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

/** Jumps `video` past the segment it is inside, if any. */
const applySegments = (video: HTMLVideoElement) => {
  const currentTime = video.currentTime;

  // Binary search the sorted segments.
  let lo = 0;
  let hi = currentSegments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (currentTime < currentSegments[mid][0]) {
      hi = mid - 1;
    } else if (currentTime >= currentSegments[mid][1]) {
      lo = mid + 1;
    } else {
      found = mid;
      break;
    }
  }

  if (found !== -1) {
    video.currentTime = currentSegments[found][1];
    if (window.electronIs.dev()) {
      console.log('SponsorBlock: skipping segment', currentSegments[found]);
    }
  }
};

/** Stored on the def context (already `this`-bound) so `stop` can `off` it. */
type SrcChangedHandler = (data: GetPlayerResponse) => Promise<void>;

export default createPlugin({
  name: () => t('plugins.sponsorblock.name'),
  description: () => t('plugins.sponsorblock.description'),
  restartNeeded: false,
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
    handleVideoSrcChanged: undefined as SrcChangedHandler | undefined,
    abortController: undefined as AbortController | undefined,
    async start({ getConfig, ipc }) {
      const fetchSegments = async (
        apiURL: string,
        categories: string[],
        videoId: string,
        signal: AbortSignal,
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
            signal,
          });
          if (resp.status !== 200) {
            return [];
          }

          const segments = (await resp.json()) as SkipSegment[];
          return sortSegments(segments.map((submission) => submission.segment));
        } catch (error) {
          if (!signal.aborted && is.dev()) {
            console.log('error on sponsorblock request:', error);
          }

          return [];
        }
      };

      const config = await getConfig();

      const { apiURL, categories } = config;

      this.handleVideoSrcChanged = async (data: GetPlayerResponse) => {
        const videoId = data?.videoDetails?.videoId;
        if (!videoId) {
          return;
        }

        this.abortController?.abort();
        const controller = new AbortController();
        this.abortController = controller;

        const segments = await fetchSegments(
          apiURL,
          categories,
          videoId,
          controller.signal,
        );
        // A newer track started while this request was in flight.
        if (controller.signal.aborted) {
          return;
        }
        ipc.send('sponsorblock-skip', segments);
      };

      ipc.on('peard:video-src-changed', this.handleVideoSrcChanged);
    },
    stop({ ipc }) {
      this.abortController?.abort();
      this.abortController = undefined;
      // Only this plugin's listener: the provider's own handler shares the
      // channel, and `removeAllListeners` would mute now-playing for everyone.
      if (this.handleVideoSrcChanged) {
        ipc.off('peard:video-src-changed', this.handleVideoSrcChanged);
        this.handleVideoSrcChanged = undefined;
      }
    },
  },
  renderer: {
    handleSkipSegments: undefined as
      | ((segments: Segment[]) => void)
      | undefined,
    video: null as HTMLVideoElement | null,
    timeUpdateListener: (e: Event) => {
      if (e.target instanceof HTMLVideoElement) {
        applySegments(e.target);
      }
    },
    resetSegments() {
      currentSegments = [];
    },
    start({ ipc }) {
      this.handleSkipSegments = (segments: Segment[]) => {
        currentSegments = segments;

        // Apply right away instead of waiting for the next `timeupdate`: the
        // segment the user is already inside should be skipped immediately.
        const video = document.querySelector<HTMLVideoElement>('video');
        if (video) {
          applySegments(video);
        }
      };
      ipc.on('sponsorblock-skip', this.handleSkipSegments);
    },
    onPlayerApiReady(playerApi, { ipc }) {
      const video = document.querySelector<HTMLVideoElement>('video');
      if (!video) return;

      this.video = video;
      video.addEventListener('timeupdate', this.timeUpdateListener);
      // 'emptied' fires when the track ends
      video.addEventListener('emptied', this.resetSegments);

      // The backend only fetches on a video change, so ask it for the current
      // track's segments instead of waiting for the next one.
      ipc.send('peard:video-src-changed', playerApi.getPlayerResponse());
      applySegments(video);
    },
    stop({ ipc }) {
      if (this.handleSkipSegments) {
        ipc.off('sponsorblock-skip', this.handleSkipSegments);
        this.handleSkipSegments = undefined;
      }
      currentSegments = [];

      const video = this.video;
      this.video = null;
      if (!video) return;

      video.removeEventListener('timeupdate', this.timeUpdateListener);
      video.removeEventListener('emptied', this.resetSegments);
    },
  },
});
