import type { SongInfo } from '@/providers/song-info';

// `time` is the max elapsed seen for `url`; track changes reset it even while disabled.
export type FinishTracker = {
  url?: string;
  duration?: number;
  time: number;
};

export const emptyFinishTracker = (): FinishTracker => ({ time: 0 });

export const trackElapsed = (
  tracker: FinishTracker,
  elapsedSeconds: number,
): void => {
  if (elapsedSeconds > tracker.time) tracker.time = elapsedSeconds;
};

export type FinishTrackerConfig = {
  enabled: boolean;
  mode: 'percent' | 'seconds';
  seconds: number;
  percent: number;
};

export const trackSongChange = (
  tracker: FinishTracker,
  songInfo: Pick<SongInfo, 'url' | 'songDuration'>,
  config: FinishTrackerConfig | undefined,
): { tracker: FinishTracker; downloadUrl?: string } => {
  if (!songInfo.url || songInfo.url === tracker.url) return { tracker };

  const finished = tracker;
  const next: FinishTracker = {
    url: songInfo.url,
    duration: songInfo.songDuration,
    time: 0,
  };

  if (
    !config?.enabled ||
    typeof finished.url !== 'string' ||
    !finished.duration ||
    finished.duration <= 0
  ) {
    return { tracker: next };
  }

  const shouldDownload =
    config.mode === 'seconds'
      ? finished.duration - finished.time <= config.seconds
      : finished.time >= finished.duration * (config.percent / 100);

  return shouldDownload
    ? { tracker: next, downloadUrl: finished.url }
    : { tracker: next };
};
