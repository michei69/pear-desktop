import { type BrowserWindow } from 'electron';

import {
  registerCallback,
  unregisterCallback,
  MediaType,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';
import { createBackend } from '@/utils';

import { decideScrobble, elapsedAt } from './schedule';
import { LastFmScrobbler, resetAuthState } from './services/lastfm';
import { ListenbrainzScrobbler } from './services/listenbrainz';
import { fetchMusicBrainzCorrection } from './services/musicbrainz';

import type { ScrobblerPluginConfig } from './index';
import type { ScrobblerBase } from './services/base';

export type SetConfType = (
  conf: Partial<Omit<ScrobblerPluginConfig, 'enabled'>>,
) => void | Promise<void>;

export const backend = createBackend<
  {
    config?: ScrobblerPluginConfig;
    window?: BrowserWindow;
    enabledScrobblers: Map<string, ScrobblerBase>;
    configRevision: number;
    generation: number;
    scrobbleTimer?: NodeJS.Timeout;
    scrobbleSubmitted: boolean;
    lastScrobbledVideoId?: string;
    lastScrobbleInfo?: SongInfo;
    lastScrobbleAt: number;
    submitScrobble(
      songInfo: SongInfo,
      config: ScrobblerPluginConfig,
      setConfig: SetConfType,
    ): void;
    rearmScrobble(config: ScrobblerPluginConfig): void;
    toggleScrobblers(
      config: ScrobblerPluginConfig,
      window: BrowserWindow,
    ): void;
    createSessions(
      config: ScrobblerPluginConfig,
      setConfig: SetConfType,
    ): Promise<void>;
    setConfig?: SetConfType;
    songInfoCallback?: (songInfo: SongInfo, event: SongInfoEvent) => void;
  },
  ScrobblerPluginConfig
>({
  enabledScrobblers: new Map(),
  configRevision: 0,
  generation: 0,
  lastScrobbleAt: 0,
  scrobbleSubmitted: false,

  submitScrobble(songInfo, config, setConfig) {
    this.scrobbleSubmitted = true;
    this.lastScrobbledVideoId = songInfo.videoId;
    this.enabledScrobblers.forEach((s) =>
      s.addScrobble(songInfo, config, setConfig),
    );
  },

  // A config change cancels the pending timer; re-arm or the track is never scrobbled.
  rearmScrobble(config) {
    // Pause/resume can arm a timer during the await; cancel it so only one timer submits.
    clearTimeout(this.scrobbleTimer);
    this.scrobbleTimer = undefined;

    const songInfo = this.lastScrobbleInfo;
    const setConfig = this.setConfig;
    if (
      !songInfo ||
      !setConfig ||
      songInfo.isPaused ||
      this.enabledScrobblers.size === 0
    ) {
      return;
    }

    const decision = decideScrobble({
      elapsedSeconds: elapsedAt(
        songInfo.elapsedSeconds ?? 0,
        this.lastScrobbleAt,
      ),
      songDuration: songInfo.songDuration,
      alreadyScrobbled: this.scrobbleSubmitted,
    });
    const configRevision = this.configRevision;
    const generation = this.generation;

    if (decision.action === 'now') {
      this.submitScrobble(songInfo, config, setConfig);
    } else if (decision.action === 'after') {
      this.scrobbleTimer = setTimeout(() => {
        if (
          generation !== this.generation ||
          configRevision !== this.configRevision ||
          this.scrobbleSubmitted
        ) {
          return;
        }
        this.submitScrobble(songInfo, config, setConfig);
      }, decision.delayMs);
    }
  },

  toggleScrobblers(config: ScrobblerPluginConfig, window: BrowserWindow) {
    if (config.scrobblers.lastfm && config.scrobblers.lastfm.enabled) {
      this.enabledScrobblers.set('lastfm', new LastFmScrobbler(window));
    } else {
      this.enabledScrobblers.delete('lastfm');
    }

    if (
      config.scrobblers.listenbrainz &&
      config.scrobblers.listenbrainz.enabled
    ) {
      this.enabledScrobblers.set('listenbrainz', new ListenbrainzScrobbler());
    } else {
      this.enabledScrobblers.delete('listenbrainz');
    }
  },

  async createSessions(config: ScrobblerPluginConfig, setConfig: SetConfType) {
    for (const [, scrobbler] of this.enabledScrobblers) {
      if (!scrobbler.isSessionCreated(config)) {
        await scrobbler.createSession(config, setConfig);
      }
    }
  },

  async start({ getConfig, setConfig, window }) {
    const startedAt = ++this.generation;
    const config = (this.config = await getConfig());
    if (startedAt !== this.generation) return;

    let callbackGeneration = 0;

    // Keep scrobbleSubmitted across stop/start: re-enable on the same track must not resubmit.
    this.lastScrobbleInfo = undefined;
    this.lastScrobbleAt = 0;

    this.window = window;
    this.toggleScrobblers(config, window);
    await this.createSessions(config, setConfig);
    if (startedAt !== this.generation) return;
    this.setConfig = setConfig;

    this.songInfoCallback = async (songInfo: SongInfo, event) => {
      if (event === SongInfoEvent.TimeChanged) return;
      const currentGeneration = ++callbackGeneration;

      // Clear the previous scrobble timer
      clearTimeout(this.scrobbleTimer);
      this.scrobbleTimer = undefined;

      // New track may scrobble again; drop the old info so a config change cannot resubmit it.
      if (event === SongInfoEvent.VideoSrcChanged) {
        this.scrobbleSubmitted = false;
        this.lastScrobbleInfo = undefined;
      }

      // Re-enable on the same track keeps the submitted memory; a different track releases it.
      if (songInfo.videoId !== this.lastScrobbledVideoId) {
        this.scrobbleSubmitted = false;
      }

      if (songInfo.isPaused) {
        this.lastScrobbleInfo = songInfo;
        this.lastScrobbleAt = Date.now();
        return;
      }

      const configNonnull = this.config!;
      const currentConfigRevision = this.configRevision;
      // Official music videos scrobble fine
      if (
        !configNonnull.scrobbleOtherMedia &&
        songInfo.mediaType !== MediaType.Audio &&
        songInfo.mediaType !== MediaType.OriginalMusicVideo
      ) {
        return;
      }

      // The title and artist were already filtered by the song-info provider.
      let title = songInfo.scrobbleTitle;
      let artist = songInfo.scrobbleArtist;

      if (configNonnull.useMusicBrainz && configNonnull.musicBrainzEmail) {
        const isCorrectionObsolete = () =>
          currentGeneration !== callbackGeneration ||
          currentConfigRevision !== this.configRevision;
        const corrected = await fetchMusicBrainzCorrection(
          title,
          artist,
          configNonnull.musicBrainzEmail,
          isCorrectionObsolete,
        );

        if (isCorrectionObsolete()) return;

        if (corrected) {
          title = corrected.title;
          artist = corrected.artist;
        }
      }

      const processedSongInfo = {
        ...songInfo,
        title,
        artist,
        alternativeTitle: undefined,
        tags: undefined,
      };

      this.lastScrobbleInfo = processedSongInfo;
      this.lastScrobbleAt = Date.now();

      const decision = decideScrobble({
        elapsedSeconds: processedSongInfo.elapsedSeconds || 0,
        songDuration: processedSongInfo.songDuration,
        alreadyScrobbled: this.scrobbleSubmitted,
      });

      if (decision.action === 'now') {
        this.submitScrobble(processedSongInfo, configNonnull, setConfig);
      } else if (decision.action === 'after') {
        const generation = this.generation;
        this.scrobbleTimer = setTimeout(() => {
          if (
            generation !== this.generation ||
            currentConfigRevision !== this.configRevision ||
            this.scrobbleSubmitted
          ) {
            return;
          }
          this.submitScrobble(processedSongInfo, configNonnull, setConfig);
        }, decision.delayMs);
      }

      this.enabledScrobblers.forEach((s) =>
        s.setNowPlaying(processedSongInfo, configNonnull, setConfig),
      );
    };

    registerCallback(this.songInfoCallback);
  },

  stop() {
    this.generation++;
    clearTimeout(this.scrobbleTimer);
    this.scrobbleTimer = undefined;
    this.lastScrobbleInfo = undefined;
    this.lastScrobbleAt = 0;
    resetAuthState();
    if (this.songInfoCallback) {
      unregisterCallback(this.songInfoCallback);
    }
    this.enabledScrobblers.clear();
  },

  async onConfigChange(newConfig: ScrobblerPluginConfig) {
    // Disabling Last.fm must close its auth window/latch, or a later enable waits forever.
    if (
      this.config?.scrobblers.lastfm.enabled &&
      !newConfig.scrobblers.lastfm.enabled
    ) {
      resetAuthState();
    }

    // A scrobble scheduled under the old config must not fire afterwards.
    clearTimeout(this.scrobbleTimer);
    this.scrobbleTimer = undefined;
    this.configRevision++;
    this.enabledScrobblers.clear();

    this.toggleScrobblers(newConfig, this.window!);
    for (const [scrobblerName, scrobblerConfig] of Object.entries(
      newConfig.scrobblers,
    )) {
      if (scrobblerConfig.enabled) {
        const scrobbler = this.enabledScrobblers.get(scrobblerName);
        if (
          this.config?.scrobblers?.[
            scrobblerName as keyof typeof newConfig.scrobblers
          ]?.enabled !== scrobblerConfig.enabled &&
          scrobbler &&
          !scrobbler.isSessionCreated(newConfig) &&
          this.setConfig
        ) {
          await scrobbler.createSession(newConfig, this.setConfig);
        }
      }
    }

    this.config = newConfig;

    this.rearmScrobble(newConfig);
  },
});
