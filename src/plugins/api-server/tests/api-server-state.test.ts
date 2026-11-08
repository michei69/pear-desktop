import { registerHooks } from 'node:module';

import { expect, test } from '@playwright/test';

import type {
  createPlayerState as CreatePlayerState,
  PlayerEvent,
} from '../backend/state';
import type { SongInfo } from '@/providers/song-info';

/**
 * The state mirror only needs the song-info callback seam and the IPC
 * subscribe helper, both of which are Electron-bound. They are stubbed for the
 * duration of the import so the mirror itself runs as the real module.
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

const STUB_IPC = `data:text/javascript,${encodeURIComponent(
  'export const subscribeIpc = () => () => {};',
)}`;

let stubbing = false;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!stubbing) return nextResolve(specifier, context);
    if (specifier === '@/providers/song-info') {
      return { url: STUB_SONG_INFO, shortCircuit: true };
    }
    if (specifier === './ipc' && context.parentURL?.endsWith('/state.ts')) {
      return { url: STUB_IPC, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

type State = ReturnType<typeof CreatePlayerState>;
let createPlayerState: typeof CreatePlayerState;

test.beforeAll(async () => {
  stubbing = true;
  ({ createPlayerState } = await import('../backend/state'));
  stubbing = false;
});

const song = (overrides: Partial<SongInfo> = {}): SongInfo =>
  ({
    videoId: 'vid',
    title: 'Song',
    artist: 'Artist',
    songDuration: 200,
    ...overrides,
  }) as SongInfo;

const emit = (info: SongInfo, event: 'video' | 'play' | 'time') => {
  (
    globalThis as unknown as {
      __emitSongInfo: (info: SongInfo, event: string) => void;
    }
  ).__emitSongInfo(info, event);
};

const collect = (state: State) => {
  const events: PlayerEvent[] = [];
  state.subscribe((event) => events.push(event));
  return events;
};

test('an unreported pause flag is unknown, never playing', () => {
  const state = createPlayerState();
  const events = collect(state);

  // A song without a reported pause flag used to read as "playing" because
  // `!undefined` is true.
  emit(song(), 'video');
  expect(state.playing).toBeUndefined();
  expect(state.snapshot().isPlaying).toBe(false);
  expect(events).toEqual([
    { type: 'VIDEO_CHANGED', song: expect.anything(), position: 0 },
  ]);

  emit(song({ isPaused: false }), 'play');
  expect(state.playing).toBe(true);
  expect(state.snapshot().isPlaying).toBe(true);

  emit(song({ isPaused: true }), 'play');
  expect(state.playing).toBe(false);

  state.stop();
});

test('the stop frame is delivered even when identical to a recent pause', () => {
  const state = createPlayerState();
  const events = collect(state);

  // Pause at 12 s: the frame a `notifyStopped()` would produce right after.
  emit(song({ isPaused: true, elapsedSeconds: 12 }), 'play');
  events.length = 0;

  state.notifyStopped();

  expect(events).toEqual([
    { type: 'PLAYER_STATE_CHANGED', isPlaying: false, position: 12 },
  ]);

  state.stop();
});
