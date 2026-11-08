import is from 'electron-is';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { buildSegmentsGradient, markerAt } from './markers';
import { sortSegments } from './segments';
import style from './style.css?inline';

import type { Segment, SegmentMarker, SkipSegment } from './types';
import type { GetPlayerResponse } from '@/types/get-player-response';
import type { MusicPlayer } from '@/types/music-player';

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
/** Where the playhead sits on the track, as the marker mask's cut-out. */
const PLAYHEAD_PROPERTY = '--pear-sponsorblock-playhead';
/**
 * Where the markers go: the `tp-yt-paper-progress` track of YTM's classic seek
 * slider, or the new-UI miniplayer's full-width progress line.
 */
const SEGMENTS_BAR_CONTAINERS = [
  '#progress-bar>#sliderContainer>div>#sliderBar>#progressContainer',
  '.ytMusicMiniPlayerProgressBarWrapper',
];

/** Paints the segments' colours over the seek track, or clears them. */
const renderMarkers = (video: HTMLVideoElement | null) => {
  const duration = video?.duration ?? 0;
  const gradient = showMarkers
    ? buildSegmentsGradient(segmentMarkers, duration)
    : '';

  const existing = document.querySelector<HTMLElement>(`#${SEGMENTS_BAR_ID}`);
  if (!gradient) {
    existing?.remove();
    return;
  }

  const playhead =
    video && Number.isFinite(duration) && duration > 0
      ? `${(video.currentTime / duration) * 100}%`
      : '0%';

  if (existing) {
    existing.style.backgroundImage = gradient;
    existing.style.setProperty(PLAYHEAD_PROPERTY, playhead);
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
  bar.style.setProperty(PLAYHEAD_PROPERTY, playhead);
  // Last child: the markers paint over YTM's played progress. The knob stays
  // on top of them (a later sibling on the classic bar; the input's own thumb
  // on the new-UI bar, which the stylesheet uncovers at the playhead).
  container.append(bar);
  trackHover(container);
};

/** Moves the marker cut-out with the playhead, re-adding the bar if YTM
 * rebuilt its seek track. */
const syncMarkers = (video: HTMLVideoElement) => {
  const bar = document.querySelector<HTMLElement>(`#${SEGMENTS_BAR_ID}`);
  if (!bar) {
    renderMarkers(video);
    return;
  }
  if (Number.isFinite(video.duration) && video.duration > 0) {
    bar.style.setProperty(
      PLAYHEAD_PROPERTY,
      `${(video.currentTime / video.duration) * 100}%`,
    );
  }
};

/** YTM's own hover timestamp above the seek bar, on either player bar. */
const HOVER_TIME_SELECTOR = '#hover-time-info, .ytMusicMiniPlayerHoverTimeInfo';
const HOVER_LABEL_ID = 'pear-sponsorblock-hover';

let markerVideo: HTMLVideoElement | null = null;
let stopHoverTracking: (() => void) | undefined;

/** The segment currently under the pointer, and where the pointer is. */
let hovered: { category: string; pointerX: number; trackTop: number } | null =
  null;

/** Sits the label just above YTM's timestamp (or above the track). */
const positionHoverLabel = () => {
  const label = document.querySelector<HTMLElement>(`#${HOVER_LABEL_ID}`);
  if (!hovered || !label || label.style.display === 'none') {
    return;
  }

  const tooltipElement =
    document.querySelector<HTMLElement>(HOVER_TIME_SELECTOR);
  const tooltip = tooltipElement?.getBoundingClientRect();
  const hasTooltip = !!tooltip && tooltip.width > 0 && tooltip.height > 0;
  if (hasTooltip && tooltipElement) {
    // Match the timestamp's own surface (it is black on the new-UI bar).
    label.style.backgroundColor =
      getComputedStyle(tooltipElement).backgroundColor;
  }
  const centerX = hasTooltip ? tooltip.x + tooltip.width / 2 : hovered.pointerX;
  const top = hasTooltip
    ? tooltip.y - label.offsetHeight - 6
    : hovered.trackTop - label.offsetHeight - 6;
  label.style.transform = `translate(${Math.round(centerX)}px, ${Math.round(top)}px) translateX(-50%)`;
};

const hideHoverLabel = () => {
  hovered = null;
  const label = document.querySelector<HTMLElement>(`#${HOVER_LABEL_ID}`);
  if (label) {
    label.style.display = 'none';
  }
};

const resetSegmentState = () => {
  currentSegments = [];
  segmentMarkers = [];
  document.querySelector(`#${SEGMENTS_BAR_ID}`)?.remove();
  hideHoverLabel();
};

/** Names the segment under the pointer, right above YTM's timestamp. */
const showHoverLabel = (
  category: string,
  pointerX: number,
  trackTop: number,
) => {
  hovered = { category, pointerX, trackTop };

  let label = document.querySelector<HTMLElement>(`#${HOVER_LABEL_ID}`);
  if (!label) {
    label = document.createElement('div');
    label.id = HOVER_LABEL_ID;
    document.body.append(label);
  }

  const text = t(`plugins.sponsorblock.settings.category.${category}`, {
    defaultValue: category,
  });
  if (label.textContent !== text) {
    label.textContent = text;
  }
  label.style.display = 'block';

  // YTM creates/moves its timestamp in a handler that runs after ours, so the
  // next frames re-anchor the label above it instead of guessing.
  positionHoverLabel();
  requestAnimationFrame(positionHoverLabel);
  setTimeout(positionHoverLabel, 60);
};

/** Follows the pointer along the seek bar to label the segment under it. */
const trackHover = (container: HTMLElement) => {
  stopHoverTracking?.();

  // The classic bar's slider covers the track; the new-UI bar's input is the
  // hover target YTM shows its own timestamp for.
  const host =
    container.closest<HTMLElement>('#progress-bar') ??
    container.querySelector<HTMLElement>('input') ??
    container;

  const onMove = (event: MouseEvent) => {
    const duration = markerVideo?.duration ?? 0;
    const rect = container.getBoundingClientRect();
    if (
      !showMarkers ||
      segmentMarkers.length === 0 ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      rect.width <= 0
    ) {
      hideHoverLabel();
      return;
    }

    const time = ((event.clientX - rect.left) / rect.width) * duration;
    const marker = markerAt(segmentMarkers, time);
    if (!marker) {
      hideHoverLabel();
      return;
    }

    showHoverLabel(marker.category, event.clientX, rect.top);
  };

  const onLeave = () => hideHoverLabel();

  host.addEventListener('mousemove', onMove);
  host.addEventListener('mouseleave', onLeave);
  stopHoverTracking = () => {
    host.removeEventListener('mousemove', onMove);
    host.removeEventListener('mouseleave', onLeave);
    stopHoverTracking = undefined;
    hideHoverLabel();
  };
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
    api: null as MusicPlayer | null,
    video: null as HTMLVideoElement | null,
    videoDataListener: (name: 'newdata' | 'dataloaded' | 'dataupdated') => {
      if (name !== 'dataloaded') return;
      // Fetch follows this event; `emptied` can fire after it and wipe fresh segments.
      resetSegmentState();
    },
    timeUpdateListener: (e: Event) => {
      if (!(e.target instanceof HTMLVideoElement)) return;
      applySegments(e.target);
      // Moves the playhead cut-out, and re-adds the bar if YTM rebuilt the
      // seek slider (the markers must follow it instead of vanishing).
      syncMarkers(e.target);
    },
    durationChangeListener: (e: Event) => {
      if (e.target instanceof HTMLVideoElement) {
        renderMarkers(e.target);
      }
    },
    resetSegments() {
      resetSegmentState();
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
        renderMarkers(video);
      };
      ipc.on('sponsorblock-skip', this.handleSkipSegments);
    },
    onPlayerApiReady(playerApi, { ipc }) {
      const video = document.querySelector<HTMLVideoElement>('video');
      if (!video) return;

      this.api?.removeEventListener('videodatachange', this.videoDataListener);
      this.api = playerApi;
      this.video = video;
      markerVideo = video;
      video.addEventListener('timeupdate', this.timeUpdateListener);
      // Duration is unknown when the plugin starts; the bar waits for it.
      video.addEventListener('durationchange', this.durationChangeListener);
      playerApi.addEventListener('videodatachange', this.videoDataListener);

      // The backend only fetches on a video change, so ask it for the current
      // track's segments instead of waiting for the next one.
      ipc.send('peard:video-src-changed', playerApi.getPlayerResponse());
      applySegments(video);
      renderMarkers(video);
    },
    onConfigChange(config: SponsorBlockPluginConfig) {
      showMarkers = config.showSegmentsOnProgressBar === true;
      renderMarkers(document.querySelector<HTMLVideoElement>('video'));
    },
    stop({ ipc }) {
      if (this.handleSkipSegments) {
        ipc.off('sponsorblock-skip', this.handleSkipSegments);
        this.handleSkipSegments = undefined;
      }
      this.resetSegments();
      stopHoverTracking?.();
      document.querySelector(`#${HOVER_LABEL_ID}`)?.remove();

      this.api?.removeEventListener('videodatachange', this.videoDataListener);
      this.api = null;

      const video = this.video;
      this.video = null;
      markerVideo = null;
      if (!video) return;

      video.removeEventListener('timeupdate', this.timeUpdateListener);
      video.removeEventListener('durationchange', this.durationChangeListener);
    },
  },
});
