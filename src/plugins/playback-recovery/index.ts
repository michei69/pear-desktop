import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import type { MusicPlayer } from '@/types/music-player';

/**
 * How long playback has to run without a failure before the retry ladder is
 * reset: a stream that only stutters forward must keep its failure count.
 */
const HEALTHY_PLAYBACK_MS = 10_000;

export type PlaybackRecoveryConfig = {
  enabled: boolean;
  stallTimeoutMs: number;
  maxRetries: number;
  logToConsole: boolean;
};

export default createPlugin<
  unknown,
  unknown,
  {
    config: PlaybackRecoveryConfig | null;
    api: MusicPlayer | null;
    watchdog: number | undefined;
    videoObserver: MutationObserver | null;
    stallTimer: number | undefined;
    recoveryTimer: number | undefined;
    mediaVideo: HTMLVideoElement | null;
    consecutiveFailures: number;
    lastGoodTime: number;
    lastGoodTimestamp: number;
    /** When the last recovery attempt started, for the healthy-window reset. */
    lastFailureTimestamp: number;
    recovering: boolean;
    log: (msg: string) => void;
    getVideo: () => HTMLVideoElement | null;
    hookMediaEvents: () => void;
    _attachMediaEvents: ((video: HTMLVideoElement) => void) | null;
    _detachMediaEvents: (() => void) | null;
    _onTimeUpdate: (() => void) | null;
    _onError: (() => void) | null;
    _onStalled: (() => void) | null;
    _onWaiting: (() => void) | null;
    _onTrackChange: (() => void) | null;
    watchVideoElement: () => void;
    startWatchdog: () => void;
    attemptRecovery: (reason: string) => void;
    teardown: () => void;
  },
  PlaybackRecoveryConfig
>({
  name: () => t('plugins.playback-recovery.name'),
  description: () => t('plugins.playback-recovery.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    stallTimeoutMs: 8000,
    maxRetries: 5,
    logToConsole: true,
  },
  settings: [
    {
      type: 'slider',
      key: 'stallTimeoutMs',
      label: () => t('plugins.playback-recovery.settings.stall-timeout'),
      description: () =>
        t('plugins.playback-recovery.settings.stall-timeout-description'),
      min: 1000,
      max: 30000,
      step: 500,
      unit: 'ms',
    },
    {
      type: 'slider',
      key: 'maxRetries',
      label: () => t('plugins.playback-recovery.settings.max-retries'),
      description: () =>
        t('plugins.playback-recovery.settings.max-retries-description'),
      min: 1,
      max: 20,
      step: 1,
    },
    {
      type: 'switch',
      key: 'logToConsole',
      label: () => t('plugins.playback-recovery.menu.log-to-console'),
    },
  ],
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();

    return [
      {
        label: t('plugins.playback-recovery.menu.log-to-console'),
        type: 'checkbox',
        checked: config.logToConsole,
        async click() {
          const nowConfig = await getConfig();
          setConfig({ logToConsole: !nowConfig.logToConsole });
        },
      },
    ];
  },
  renderer: {
    config: null,
    api: null,
    watchdog: undefined,
    videoObserver: null,
    stallTimer: undefined,
    recoveryTimer: undefined,
    mediaVideo: null,
    _attachMediaEvents: null,
    _detachMediaEvents: null,
    _onTimeUpdate: null,
    _onError: null,
    _onStalled: null,
    _onWaiting: null,
    _onTrackChange: null,
    consecutiveFailures: 0,
    lastGoodTime: 0,
    lastGoodTimestamp: 0,
    lastFailureTimestamp: 0,
    recovering: false,

    async start({ getConfig }) {
      this.config = await getConfig();
    },

    onPlayerApiReady(api) {
      // Re-enabling the plugin calls this again without an unload between.
      this.teardown();
      this.api = api;
      this.log('Playback recovery active');
      this.startWatchdog();
      this.watchVideoElement();
      this.hookMediaEvents();
    },

    stop() {
      this.teardown();
      this.api = null;
    },

    teardown() {
      clearInterval(this.watchdog);
      this.watchdog = undefined;

      this.videoObserver?.disconnect();
      this.videoObserver = null;

      clearTimeout(this.stallTimer);
      this.stallTimer = undefined;

      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = undefined;

      // A teardown can land mid-recovery; a stale flag would block the next
      // watchdog/recovery cycle after the plugin is re-enabled.
      this.recovering = false;
      this.consecutiveFailures = 0;
      this.lastGoodTime = 0;
      this.lastGoodTimestamp = 0;
      this.lastFailureTimestamp = 0;

      this._detachMediaEvents?.();
      this._attachMediaEvents = null;
      this._detachMediaEvents = null;
    },

    onConfigChange(newConfig) {
      this.config = newConfig;
    },

    // --- Internal methods attached as properties ---

    log(msg: string) {
      if (this.config?.logToConsole) {
        console.log(`[playback-recovery] ${msg}`);
      }
    },

    getVideo(): HTMLVideoElement | null {
      return document.querySelector('video');
    },

    hookMediaEvents() {
      this._onTimeUpdate = () => {
        const video = this.mediaVideo;
        if (video && video.currentTime > 0 && !video.paused) {
          this.lastGoodTime = video.currentTime;
          this.lastGoodTimestamp = Date.now();
          // The stall resolved, so its timer must not fire on a later stall.
          if (this.stallTimer !== undefined) {
            clearTimeout(this.stallTimer);
            this.stallTimer = undefined;
          }
          // A stream that advances a fraction of a second and stalls again
          // ticks here too: the ladder is only reset once playback has stayed
          // healthy for a sustained window since the last attempt.
          if (Date.now() - this.lastFailureTimestamp >= HEALTHY_PLAYBACK_MS) {
            this.consecutiveFailures = 0;
            this.recovering = false;
          }
        }
      };

      this._onError = () => {
        const video = this.mediaVideo;
        const code = video?.error?.code ?? 0;
        const msg = video?.error?.message ?? '';
        this.log(`Media error: code=${code} msg="${msg}"`);
        this.attemptRecovery('media-error');
      };

      // Recover if the stall does not clear. A second event must not push the
      // deadline out again, or a stream that keeps reporting the stall would
      // never reach the timeout. Both handlers share the same "cannot continue
      // playback" predicate (`readyState < 3`), so a timer armed by `waiting`
      // still fires when a later `stalled` event lands at HAVE_CURRENT_DATA
      // instead of leaving the state with no recovery path.
      this._onStalled = () => {
        if (this.stallTimer !== undefined) return;
        this.log('Stream stalled, waiting for recovery...');
        this.stallTimer = window.setTimeout(() => {
          this.stallTimer = undefined;
          const v = this.getVideo();
          if (v && !v.paused && v.readyState < 3) {
            this.log('Stall did not resolve');
            this.attemptRecovery('stall-timeout');
          }
        }, this.config?.stallTimeoutMs ?? 8000);
      };

      // Recover if buffering persists. Like `stalled`, a repeated event keeps
      // the already-running timer instead of restarting it, and the shared
      // predicate covers the readyState-2 stall `waiting` reports.
      this._onWaiting = () => {
        if (this.stallTimer !== undefined) return;
        this.stallTimer = window.setTimeout(() => {
          this.stallTimer = undefined;
          const v = this.getVideo();
          if (v && !v.paused && v.readyState < 3) {
            this.log('Buffering did not resolve');
            this.attemptRecovery('buffer-timeout');
          }
        }, this.config?.stallTimeoutMs ?? 8000);
      };

      // A new media load is a new track, so the retry ladder starts over: two
      // failures on the previous track must not make the next one skip earlier
      // than policy. `emptied`/`loadstart` only fire for a load, not for the
      // seeks recovery itself issues.
      this._onTrackChange = () => {
        this.consecutiveFailures = 0;
        this.lastFailureTimestamp = 0;
        this.recovering = false;
        // Give the new track its own stall-timeout grace period.
        this.lastGoodTimestamp = Date.now();
        clearTimeout(this.stallTimer);
        this.stallTimer = undefined;
      };

      const attachTo = (video: HTMLVideoElement) => {
        // Track the element we hooked so stop() can unhook it and so the
        // observer does not attach twice to the same one.
        if (this.mediaVideo === video) return;
        this._detachMediaEvents?.();

        this.mediaVideo = video;
        video.addEventListener('timeupdate', this._onTimeUpdate!);
        video.addEventListener('error', this._onError!);
        video.addEventListener('stalled', this._onStalled!);
        video.addEventListener('waiting', this._onWaiting!);
        video.addEventListener('emptied', this._onTrackChange!);
        video.addEventListener('loadstart', this._onTrackChange!);
      };

      this._detachMediaEvents = () => {
        const video = this.mediaVideo;
        if (!video) return;

        if (this._onTimeUpdate)
          video.removeEventListener('timeupdate', this._onTimeUpdate);
        if (this._onError) video.removeEventListener('error', this._onError);
        if (this._onStalled)
          video.removeEventListener('stalled', this._onStalled);
        if (this._onWaiting)
          video.removeEventListener('waiting', this._onWaiting);
        if (this._onTrackChange) {
          video.removeEventListener('emptied', this._onTrackChange);
          video.removeEventListener('loadstart', this._onTrackChange);
        }

        this.mediaVideo = null;
      };

      const video = this.getVideo();
      if (video) attachTo(video);

      // Kept for watchVideoElement's observer to re-attach on recreation.
      this._attachMediaEvents = attachTo;
    },

    watchVideoElement() {
      this.videoObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.removedNodes) {
            if (
              node instanceof HTMLElement &&
              (node.tagName === 'VIDEO' || node.tagName === 'AUDIO')
            ) {
              this.log('Video element removed from DOM');
            }
          }
          for (const node of mutation.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            const video =
              node instanceof HTMLVideoElement
                ? node
                : node.querySelector<HTMLVideoElement>('video');
            if (video) {
              this.log(
                'New video element detected — re-attaching recovery hooks',
              );
              this._attachMediaEvents?.(video);
            }
          }
        }
      });
      const observerTarget =
        document.querySelector('ytmusic-player') ??
        document.querySelector('#movie_player') ??
        document.querySelector('ytmusic-app') ??
        document.body;
      this.videoObserver.observe(observerTarget, {
        childList: true,
        subtree: true,
      });
    },

    startWatchdog() {
      // `lastGoodTimestamp` is a time, not a flag: starting from 0 would make
      // the first dead-playback check see an infinite stall. Count the grace
      // period from the moment the watchdog starts instead.
      this.lastGoodTimestamp = Date.now();
      this.watchdog = window.setInterval(() => {
        if (this.recovering) return;

        const video = this.getVideo();
        if (!video) return;

        const playerState = this.api?.getPlayerState?.();
        const isPlaying = playerState === 1; // 1 = playing
        if (!isPlaying) return;

        const now = Date.now();

        if (video.readyState === 0 && !video.paused) {
          const elapsed = now - this.lastGoodTimestamp;
          if (
            this.lastGoodTimestamp > 0 &&
            elapsed > (this.config?.stallTimeoutMs ?? 8000)
          ) {
            this.log(
              `Dead playback: readyState=0, no progress for ${elapsed}ms`,
            );
            this.attemptRecovery('dead-playback');
            return;
          }
        }

        if (!video.paused && video.currentTime > 0) {
          const timeSinceGood = now - this.lastGoodTimestamp;
          if (
            timeSinceGood > (this.config?.stallTimeoutMs ?? 8000) &&
            this.lastGoodTimestamp > 0
          ) {
            this.log(
              `Playback frozen: currentTime=${video.currentTime.toFixed(1)}, no progress for ${timeSinceGood}ms`,
            );
            this.attemptRecovery('frozen-playback');
            return;
          }
        }

        if (!video.paused && video.buffered.length > 0) {
          const bufferEnd = video.buffered.end(video.buffered.length - 1);
          const ahead = bufferEnd - video.currentTime;
          if (ahead <= 0 && video.readyState < 3) {
            this.log(
              `Buffer exhausted: ahead=${ahead.toFixed(1)}s, readyState=${video.readyState}`,
            );
            this.attemptRecovery('buffer-exhausted');
          }
        }
      }, 3000);
    },

    attemptRecovery(reason: string) {
      if (this.recovering) return;

      const maxRetries = this.config?.maxRetries ?? 5;
      this.consecutiveFailures++;
      // Recorded so a brief `timeupdate` after the attempt cannot reset the
      // ladder before playback has actually stayed healthy.
      this.lastFailureTimestamp = Date.now();

      if (this.consecutiveFailures > maxRetries) {
        this.log(
          `Max retries (${maxRetries}) exceeded — skipping to next track`,
        );
        this.recovering = true;
        this.consecutiveFailures = 0;
        try {
          this.api?.nextVideo();
          this.log('Skipped to next track');
        } catch (e) {
          this.log('Failed to skip: ' + String(e));
        }
        // Give the next track time to load before the watchdog resumes.
        clearTimeout(this.recoveryTimer);
        this.recoveryTimer = window.setTimeout(() => {
          this.recoveryTimer = undefined;
          this.recovering = false;
          this.lastGoodTimestamp = Date.now();
        }, 5000);
        return;
      }

      this.log(
        `Recovery attempt ${this.consecutiveFailures}/${maxRetries} — reason: ${reason}`,
      );
      this.recovering = true;

      const video = this.getVideo();
      const currentTime = video?.currentTime ?? 0;

      // Seek to the current position to force a buffer reload.
      if (this.consecutiveFailures <= 2) {
        this.log('Strategy: seek-to-current');
        try {
          if (this.api && currentTime > 0) {
            this.api.seekTo(currentTime);
            this.api.playVideo();
          } else if (this.api) {
            this.api.playVideo();
          }
        } catch (e) {
          this.log('Seek failed: ' + String(e));
        }
      }
      // Seek slightly forward to reload the video. Every attempt below the
      // retry cap has a strategy: attempts past the second one keep seeking
      // forward until the ladder escalates to the next track.
      else {
        this.log('Strategy: seek-forward');
        try {
          const duration = video?.duration ?? 0;
          const seekTarget =
            Number.isFinite(duration) && duration > 0
              ? Math.min(currentTime + 1, duration - 0.5)
              : currentTime + 1;
          if (this.api && currentTime > 0) {
            this.api.seekTo(seekTarget);
            this.api.playVideo();
          } else if (this.api) {
            this.api.playVideo();
          }
        } catch (e) {
          this.log('Seek-forward failed: ' + String(e));
        }
      }

      // Allow recovery to settle before checking again
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = window.setTimeout(() => {
        this.recoveryTimer = undefined;
        this.recovering = false;
        this.lastGoodTimestamp = Date.now();
      }, 4000);
    },
  },
});
