import type { SongInfo } from '@/providers/song-info';

/**
 * "Download on finish" state for the playing session. `time` is the highest
 * elapsed position seen for `url`: TimeChanged ticks feed it, and it resets
 * whenever the track changes — even while the feature is off. Keeping the
 * tracker on the current track while disabled means a later enable cannot
 * compare the previous track's duration with this track's elapsed time (which
 * used to download a stale url).
 */
export type FinishTracker = {
  url?: string;
  duration?: number;
  time: number;
};

export const emptyFinishTracker = (): FinishTracker => ({ time: 0 });

/** Fold a TimeChanged tick into the tracker: `time` is a maximum, not a position. */
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

/**
 * Fold a non-TimeChanged song-info event into the tracker. Returns the url to
 * download when the track that just ended passed the configured threshold.
 */
export const trackSongChange = (
  tracker: FinishTracker,
  songInfo: Pick<SongInfo, 'url' | 'songDuration'>,
  config: FinishTrackerConfig | undefined,
): { tracker: FinishTracker; downloadUrl?: string } => {
  // Pause/resume and other events for the same track must not reset the max.
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
