import { registerHooks } from 'node:module';

import { expect, test } from '@playwright/test';

import type { SongInfo } from '@/providers/song-info';

/**
 * The Lumia plugin is Electron-bound through `net.fetch` and the song-info
 * callback registry; both are stubbed for the duration of the import so the
 * event-type decision can be exercised directly.
 */
const STUB_SONG_INFO = `data:text/javascript,${encodeURIComponent(`
const callbacks = new Set();
export const SongInfoEvent = {
  VideoSrcChanged: 'video',
  PlayOrPaused: 'play',
  TimeChanged: 'time',
};
export const registerCallback = (callback) => callbacks.add(callback);
export const unregisterCallback = (callback) => callbacks.delete(callback);
globalThis.__emitSongInfo = (info, event) => {
  for (const callback of callbacks) callback(info, event);
};
`)}`;

const STUB_ELECTRON = `data:text/javascript,${encodeURIComponent(`
globalThis.__lumiaPosts = [];
export const net = {
  fetch: async (_url, options) => {
    globalThis.__lumiaPosts.push(JSON.parse(options.body));
    return { ok: true };
  },
};
`)}`;

let stubbing = false;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!stubbing) return nextResolve(specifier, context);
    if (specifier === 'electron') {
      return { url: STUB_ELECTRON, shortCircuit: true };
    }
    if (specifier === '@/providers/song-info') {
      return { url: STUB_SONG_INFO, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

type LumiaBackend = {
  start: () => void;
  stop: () => void;
};

let backend: LumiaBackend;

test.beforeAll(async () => {
  stubbing = true;
  const plugin =
    (await import('../src/plugins/lumiastream/index')) as unknown as {
      default: { backend: LumiaBackend };
    };
  stubbing = false;
  backend = plugin.default.backend;
});

const song = (videoId: string, isPaused = false): SongInfo =>
  ({
    videoId,
    title: 'Song',
    artist: 'Artist',
    songDuration: 200,
    isPaused,
  }) as SongInfo;

const emit = (info: SongInfo, event: 'video' | 'play' | 'time') => {
  (
    globalThis as unknown as {
      __emitSongInfo: (info: SongInfo, event: string) => void;
    }
  ).__emitSongInfo(info, event);
};

const lastEventType = () => {
  const posts = (
    globalThis as unknown as { __lumiaPosts: { data: { eventType: string } }[] }
  ).__lumiaPosts;
  return posts.at(-1)?.data.eventType;
};

test('a track change after a pause is reported as a switch again', () => {
  backend.start();

  emit(song('a'), 'play');
  const first = lastEventType();
  emit(song('a', true), 'play');
  const paused = lastEventType();
  emit(song('a', false), 'play');
  const resumed = lastEventType();
  // Same pause flag, new track: this is a switch, not a pause toggle.
  emit(song('b', false), 'play');
  const nextTrack = lastEventType();

  expect([first, paused, resumed, nextTrack]).toEqual([
    'switchSong',
    'playPause',
    'playPause',
    'switchSong',
  ]);

  backend.stop();
});
