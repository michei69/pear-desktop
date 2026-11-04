import is from 'electron-is';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { buildSegmentsGradient } from './markers';
import { sortSegments } from './segments';
import style from './style.css?inline';

import type { Segment, SegmentMarker, SkipSegment } from './types';
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
  showSegmentsOnProgressBar: boolean;
};

let currentSegments: Segment[] = [];
let segmentMarkers: SegmentMarker[] = [];
let showMarkers = false;

const SEGMENTS_BAR_ID = 'pear-sponsorblock-bar';
/**
 * Where the markers go: the `tp-yt-paper-progress` track of YTM's classic seek
 * slider, or the new-UI miniplayer's full-width progress line.
 */
const SEGMENTS_BAR_CONTAINERS = [
  '#progress-bar>#sliderContainer>div>#sliderBar>#progressContainer',
  '.ytMusicMiniPlayerProgressBarWrapper',
];

/** Paints the segments' colours over the seek track, or clears them. */
const renderMarkers = (duration: number) => {
  const gradient = showMarkers
    ? buildSegmentsGradient(segmentMarkers, duration)
    : '';

  const existing = document.querySelector<HTMLElement>(`#${SEGMENTS_BAR_ID}`);
  if (!gradient) {
    existing?.remove();
    return;
  }

  if (existing) {
    existing.style.backgroundImage = gradient;
    return;
  }

  // YTM builds its player bar after the plugins start, so this can no-op
  // until a later hook finds the track.
  const container = document.querySelector<HTMLElement>(
    SEGMENTS_BAR_CONTAINERS.join(', '),
  );
  if (!container) {
    return;
  }

  const bar = document.createElement('div');
  bar.id = SEGMENTS_BAR_ID;
  bar.style.backgroundImage = gradient;
  // First child: YTM's played progress and its knob must paint over the
  // markers, so the playhead keeps reading through a segment.
  container.prepend(bar);
};

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
  stylesheets: [style],
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
    showSegmentsOnProgressBar: false,
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
    {
      type: 'switch',
      key: 'showSegmentsOnProgressBar',
      label: () =>
        t('plugins.sponsorblock.settings.show-segments-on-progress-bar'),
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

          const submissions = (await resp.json()) as SkipSegment[];
          return submissions.map(({ segment, category }) => ({
            segment,
            category,
          }));
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

        const markers = await fetchSegments(
          apiURL,
          categories,
          videoId,
          controller.signal,
        );
        // A newer track started while this request was in flight.
        if (controller.signal.aborted) {
          return;
        }
        ipc.send('sponsorblock-skip', markers);
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
      | ((markers: SegmentMarker[]) => void)
      | undefined,
    video: null as HTMLVideoElement | null,
    timeUpdateListener: (e: Event) => {
      if (!(e.target instanceof HTMLVideoElement)) return;
      applySegments(e.target);
      // YTM rebuilds the seek slider when the layout changes; the markers must
      // follow it instead of vanishing.
      if (
        segmentMarkers.length > 0 &&
        !document.querySelector(`#${SEGMENTS_BAR_ID}`)
      ) {
        renderMarkers(e.target.duration);
      }
    },
    durationChangeListener: (e: Event) => {
      if (e.target instanceof HTMLVideoElement) {
        renderMarkers(e.target.duration);
      }
    },
    resetSegments() {
      currentSegments = [];
      segmentMarkers = [];
      document.querySelector(`#${SEGMENTS_BAR_ID}`)?.remove();
    },
    async start({ ipc, getConfig }) {
      showMarkers = (await getConfig()).showSegmentsOnProgressBar === true;

      this.handleSkipSegments = (markers: SegmentMarker[]) => {
        segmentMarkers = markers;
        currentSegments = sortSegments(markers.map((marker) => marker.segment));

        // Apply right away instead of waiting for the next `timeupdate`: the
        // segment the user is already inside should be skipped immediately.
        const video = document.querySelector<HTMLVideoElement>('video');
        if (video) {
          applySegments(video);
        }
        renderMarkers(video?.duration ?? 0);
      };
      ipc.on('sponsorblock-skip', this.handleSkipSegments);
    },
    onPlayerApiReady(playerApi, { ipc }) {
      const video = document.querySelector<HTMLVideoElement>('video');
      if (!video) return;

      this.video = video;
      video.addEventListener('timeupdate', this.timeUpdateListener);
      // Duration is unknown when the plugin starts; the bar waits for it.
      video.addEventListener('durationchange', this.durationChangeListener);
      // 'emptied' fires when the track ends
      video.addEventListener('emptied', this.resetSegments);

      // The backend only fetches on a video change, so ask it for the current
      // track's segments instead of waiting for the next one.
      ipc.send('peard:video-src-changed', playerApi.getPlayerResponse());
      applySegments(video);
      renderMarkers(video.duration);
    },
    onConfigChange(config: SponsorBlockPluginConfig) {
      showMarkers = config.showSegmentsOnProgressBar === true;
      renderMarkers(
        document.querySelector<HTMLVideoElement>('video')?.duration ?? 0,
      );
    },
    stop({ ipc }) {
      if (this.handleSkipSegments) {
        ipc.off('sponsorblock-skip', this.handleSkipSegments);
        this.handleSkipSegments = undefined;
      }
      this.resetSegments();

      const video = this.video;
      this.video = null;
      if (!video) return;

      video.removeEventListener('timeupdate', this.timeUpdateListener);
      video.removeEventListener('durationchange', this.durationChangeListener);
      video.removeEventListener('emptied', this.resetSegments);
    },
  },
});
