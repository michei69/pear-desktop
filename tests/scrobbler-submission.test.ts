import { expect, test } from '@playwright/test';

import {
  installDom,
  setUpModuleStubs,
  startStubbing,
  stopStubbing,
  uninstallDom,
} from '../src/plugins/synced-lyrics/tests/harness';

import type { SongInfo } from '../src/providers/song-info';

/**
 * The scrobbler used to have no "already submitted" state: pausing, seeking
 * back below the threshold and resuming re-armed the timer and submitted the
 * same track twice, a track first seen past its threshold was never submitted,
 * and a config change dropped the pending submission.
 *
 * `scrobbler/main.ts` is main-process code (Electron + the song-info provider),
 * so those two modules are stubbed for the duration of the import and the
 * backend is driven through the callback it registers.
 */
const ELECTRON_STUB = `data:text/javascript,${encodeURIComponent(`
export class BrowserWindow {}
export const dialog = { showMessageBox: () => {} };
export const net = { fetch: (...args) => globalThis.__scrobbleNetFetch(...args) };
export const app = { getPath: () => '/tmp' };
`)}`;

const SONG_INFO_STUB = `data:text/javascript,${encodeURIComponent(`
export const callbacks = (globalThis.__scrobbleCallbacks ??= new Set());
export const registerCallback = (callback) => callbacks.add(callback);
export const unregisterCallback = (callback) => callbacks.delete(callback);
export const MediaType = { Audio: 'AUDIO', OriginalMusicVideo: 'ORIGINAL_MUSIC_VIDEO' };
export const SongInfoEvent = {
  VideoSrcChanged: 'peard:video-src-changed',
  PlayOrPaused: 'peard:play-or-paused',
  TimeChanged: 'peard:time-changed',
};
`)}`;

setUpModuleStubs({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return { url: ELECTRON_STUB, shortCircuit: true };
    }

    const resolved = nextResolve(specifier, context);
    if (resolved.url.endsWith('/providers/song-info.ts')) {
      return { url: SONG_INFO_STUB, shortCircuit: true };
    }
    return resolved;
  },
});

/** Structural: the module's own type pulls in Electron and the i18n virtual module. */
interface Backend {
  start(ctx: {
    getConfig: () => Promise<unknown>;
    setConfig: (config: unknown) => Promise<void>;
    window: unknown;
  }): Promise<void>;
  stop(): void;
  onConfigChange(config: unknown): Promise<void>;
  enabledScrobblers: Map<string, unknown>;
}

type SongInfoCallback = (songInfo: SongInfo, event: string) => Promise<void>;

interface Harness {
  __scrobbleCallbacks?: Set<SongInfoCallback>;
  __scrobbleNetFetch?: (url: string, init?: unknown) => Promise<unknown>;
}

interface FakeScrobbler {
  addScrobble(songInfo: SongInfo): void;
  setNowPlaying(songInfo: SongInfo): void;
  isSessionCreated(): boolean;
  createSession(config: unknown): Promise<unknown>;
}

const harness = globalThis as unknown as Harness;

let backend: Backend;
let callbacks: Set<SongInfoCallback>;
const calls: string[] = [];

const fakeScrobbler: FakeScrobbler = {
  addScrobble: (songInfo) => calls.push(`scrobble:${songInfo.videoId}`),
  setNowPlaying: (songInfo) => calls.push(`now:${songInfo.videoId}`),
  isSessionCreated: () => true,
  createSession: (config) => Promise.resolve(config),
};

const config = (
  lastfm: { enabled: boolean; sessionKey?: string } = {
    enabled: true,
    sessionKey: 'session',
  },
) =>
  ({
    enabled: true,
    scrobbleOtherMedia: true,
    useMusicBrainz: false,
    musicBrainzEmail: '',
    customRegexFilters: [],
    scrobblers: {
      lastfm: {
        enabled: lastfm.enabled,
        sessionKey: lastfm.sessionKey,
        token: 'token',
        apiKey: 'api-key',
        secret: 'secret',
        apiRoot: 'https://example.test/',
      },
      listenbrainz: { enabled: false, apiRoot: '', token: undefined },
    },
  }) as never;

const song = (overrides: Partial<SongInfo> = {}): SongInfo =>
  ({
    videoId: 'song',
    title: 'Song',
    artist: 'Artist',
    scrobbleTitle: 'Song',
    scrobbleArtist: 'Artist',
    songDuration: 2,
    elapsedSeconds: 0,
    isPaused: false,
    mediaType: 'AUDIO',
    url: 'https://music.youtube.com/watch?v=song',
    ...overrides,
  }) as SongInfo;

const emit = async (songInfo: SongInfo, event: string) => {
  for (const callback of callbacks) {
    await callback(songInfo, event);
  }
};

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const useFakeScrobbler = () => {
  backend.enabledScrobblers.clear();
  backend.enabledScrobblers.set('fake', fakeScrobbler as never);
};

const start = async (pluginConfig = config()) => {
  await backend.start({
    getConfig: () => Promise.resolve(pluginConfig),
    setConfig: () => Promise.resolve(),
    window: {} as never,
  });
  useFakeScrobbler();
};

test.beforeAll(async () => {
  installDom();
  startStubbing();
  ({ backend } = (await import('../src/plugins/scrobbler/main')) as unknown as {
    backend: Backend;
  });
  stopStubbing();
  callbacks = harness.__scrobbleCallbacks!;
});

test.beforeEach(async () => {
  calls.length = 0;
  harness.__scrobbleNetFetch = () =>
    Promise.reject(new Error('network disabled in test'));
  backend.stop();
  await start();
});

test.afterAll(() => {
  backend.stop();
  uninstallDom();
});

test('a submitted track is not submitted again after seek-back and resume', async () => {
  await emit(song({ videoId: 'dup' }), 'peard:video-src-changed');

  await tick(1100);
  expect(calls).toContain('scrobble:dup');

  // Pause, seek back below the threshold, resume.
  await emit(
    song({ videoId: 'dup', isPaused: true, elapsedSeconds: 0.4 }),
    'peard:play-or-paused',
  );
  await emit(
    song({ videoId: 'dup', elapsedSeconds: 0.2 }),
    'peard:play-or-paused',
  );

  await tick(1100);
  expect(calls.filter((call) => call === 'scrobble:dup')).toHaveLength(1);
});

test('a track first seen past its threshold is submitted immediately', async () => {
  await emit(
    song({ videoId: 'mid', elapsedSeconds: 1.5 }),
    'peard:video-src-changed',
  );

  expect(calls.filter((call) => call === 'scrobble:mid')).toHaveLength(1);
});

test('a config change re-arms the pending submission', async () => {
  await emit(
    song({ videoId: 'cfg', songDuration: 4 }),
    'peard:video-src-changed',
  );

  await backend.onConfigChange(config());

  // The config change rebuilt the scrobblers; keep the fake in place for the
  // re-armed timer, which reads the map when it fires.
  useFakeScrobbler();
  await tick(2100);

  expect(calls.filter((call) => call === 'scrobble:cfg')).toHaveLength(1);
});

test('a config change racing a pause/resume cannot submit twice', async () => {
  // Start with Last.fm disabled so the config change below has to create a
  // session, which awaits and lets a pause/resume arm a timer mid-change.
  backend.stop();
  await start(config({ enabled: false, sessionKey: 'session' }));

  await emit(
    song({ videoId: 'race', songDuration: 4 }),
    'peard:video-src-changed',
  );

  let release!: (value: unknown) => void;
  harness.__scrobbleNetFetch = () =>
    new Promise((resolve) => {
      release = resolve;
    });

  // No session key in the new config, so the change must create one (awaits).
  const changing = backend.onConfigChange(config({ enabled: true }));
  await tick(0);

  // The change rebuilt the scrobbler map; restore the fake so the timer armed
  // during the await is observable.
  useFakeScrobbler();
  await emit(
    song({
      videoId: 'race',
      songDuration: 4,
      isPaused: true,
      elapsedSeconds: 1,
    }),
    'peard:play-or-paused',
  );
  await emit(
    song({ videoId: 'race', songDuration: 4, elapsedSeconds: 1 }),
    'peard:play-or-paused',
  );

  release({ json: () => Promise.resolve({}) });
  await changing;
  useFakeScrobbler();

  await tick(1600);
  expect(calls.filter((call) => call === 'scrobble:race')).toHaveLength(1);
});

test('re-enabling on the same track does not resubmit it', async () => {
  await emit(song({ videoId: 're' }), 'peard:video-src-changed');
  await tick(1100);
  expect(calls.filter((call) => call === 'scrobble:re')).toHaveLength(1);

  // Disable and re-enable while the same track keeps playing; the track is
  // already past its threshold, which used to hit the immediate branch.
  backend.stop();
  await start();

  await emit(
    song({ videoId: 're', elapsedSeconds: 1.5 }),
    'peard:play-or-paused',
  );
  expect(calls.filter((call) => call === 'scrobble:re')).toHaveLength(1);

  // A genuinely different track still scrobbles immediately.
  await emit(
    song({ videoId: 're-next', elapsedSeconds: 1.5 }),
    'peard:video-src-changed',
  );
  expect(calls.filter((call) => call === 'scrobble:re-next')).toHaveLength(1);
});
