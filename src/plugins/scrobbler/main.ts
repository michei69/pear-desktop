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
    /** True once this track instance was submitted, so it is not sent twice. */
    scrobbleSubmitted: boolean;
    /** Video id of the last submitted track; survives plugin stop/start. */
    lastScrobbledVideoId?: string;
    /** Latest processed track, kept so a config change can re-arm its scrobble. */
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

  /** Submit the track once and remember that this track instance was submitted. */
  submitScrobble(songInfo, config, setConfig) {
    this.scrobbleSubmitted = true;
    this.lastScrobbledVideoId = songInfo.videoId;
    this.enabledScrobblers.forEach((s) =>
      s.addScrobble(songInfo, config, setConfig),
    );
  },

  /**
   * Re-arm the current track's pending scrobble after a config change. The old
   * timer is cancelled with the old config; without this, uninterrupted
   * playback produces no further event and the track is never scrobbled.
   */
  rearmScrobble(config) {
    // A pause/resume can run while `onConfigChange` awaits a session creation
    // and arm its own timer; cancel it so only one live timer can submit.
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

    // `scrobbleSubmitted` is deliberately kept across stop/start: re-enabling
    // the plugin on the same track must not resubmit a track already scrobbled.
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

      // A new track instance may scrobble again; the same track's pause, seek
      // back and resume must not (the submitted state below suppresses it). The
      // old track's info is dropped so a config change during this event cannot
      // re-arm a scrobble that was already submitted.
      if (event === SongInfoEvent.VideoSrcChanged) {
        this.scrobbleSubmitted = false;
        this.lastScrobbleInfo = undefined;
      }

      // Re-enable on the same track keeps the submitted memory; a genuinely
      // different track releases it.
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
        // The track is already past its scrobble threshold when first seen
        // (seek into it, restored position): submit now instead of never.
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
    // Keep `scrobbleSubmitted`/`lastScrobbledVideoId` so a re-enable on the same
    // track cannot resubmit it; a track change releases the memory.
    this.lastScrobbleInfo = undefined;
    this.lastScrobbleAt = 0;
    resetAuthState();
    if (this.songInfoCallback) {
      unregisterCallback(this.songInfoCallback);
    }
    this.enabledScrobblers.clear();
  },

  async onConfigChange(newConfig: ScrobblerPluginConfig) {
    // Disabling Last.fm while its auth window is open must not leave the
    // window (and its latch) behind; re-enabling would then wait forever.
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

    // Re-arm the pending scrobble under the new config instead of losing it:
    // uninterrupted playback produces no further song-info event.
    this.rearmScrobble(newConfig);
  },
});
