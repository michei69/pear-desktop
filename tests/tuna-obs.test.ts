import { registerHooks } from 'node:module';

import { expect, test } from '@playwright/test';

import type { SongInfo } from '@/providers/song-info';

/**
 * The tuna/OBS plugin is Electron-bound through `net.fetch` and the song-info
 * callback registry; both are stubbed for the duration of the import so the
 * lite-mode transitions can be exercised directly.
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
globalThis.__tunaCalls = [];
globalThis.__tunaReject = false;
export const net = {
  fetch: async (_url, options) => {
    globalThis.__tunaCalls.push({ method: options.method, body: options.body });
    if (globalThis.__tunaReject) throw { code: 'ECONNREFUSED' };
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

type Ipc = {
  send: (channel: string, flag: number) => void;
  on: (channel: string, listener: () => void) => void;
  off: (channel: string, listener: () => void) => void;
};

type TunaBackend = {
  liteMode: boolean;
  liteRetryTimer: ReturnType<typeof setTimeout> | null;
  callback: unknown;
  start: (ctx: { ipc: Ipc }) => void;
  stop: (ctx: { ipc: Ipc }) => void;
};

const ipc: Ipc = {
  send: () => undefined,
  on: () => undefined,
  off: () => undefined,
};

let backend: TunaBackend;

test.beforeAll(async () => {
  stubbing = true;
  const plugin = (await import('../src/plugins/tuna-obs/index')) as unknown as {
    default: { backend: TunaBackend };
  };
  stubbing = false;
  backend = plugin.default.backend;
});

const flush = async (times = 4) => {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const song = (videoId: string): SongInfo =>
  ({
    videoId,
    title: 'Song',
    artist: 'Artist',
    songDuration: 200,
  }) as SongInfo;

const emit = (info: SongInfo, event: 'video' | 'play' | 'time') => {
  (
    globalThis as unknown as {
      __emitSongInfo: (info: SongInfo, event: string) => void;
    }
  ).__emitSongInfo(info, event);
};

const calls = () =>
  (
    globalThis as unknown as {
      __tunaCalls: { method: string; body?: string }[];
    }
  ).__tunaCalls;

const setReject = (reject: boolean) => {
  (globalThis as unknown as { __tunaReject: boolean }).__tunaReject = reject;
};

test('a failed probe arms a real-request retry instead of latching', async () => {
  backend.start({ ipc });
  try {
    setReject(true);
    emit(song('a'), 'play');
    await flush();

    // The first failure downgrades to the empty-payload probe...
    expect(backend.liteMode).toBe(true);
    expect(calls().at(-1)?.method).toBe('POST');

    emit(song('a'), 'play');
    await flush();
    expect(calls().at(-1)?.method).toBe('OPTIONS');

    // ...but a failed probe does not leave the plugin muted forever: a retry
    // of the real request is scheduled.
    expect(backend.liteRetryTimer).not.toBeNull();
  } finally {
    backend.stop({ ipc });
  }

  // Stopping clears the retry so a disabled plugin cannot post later.
  expect(backend.liteRetryTimer).toBeNull();
  expect(backend.liteMode).toBe(false);
});

test('a successful probe re-posts the full payload', async () => {
  backend.start({ ipc });
  try {
    setReject(true);
    emit(song('a'), 'play');
    await flush();
    expect(backend.liteMode).toBe(true);

    setReject(false);
    emit(song('a'), 'play');
    await flush();

    expect(backend.liteMode).toBe(false);
    const last = calls().at(-1);
    expect(last?.method).toBe('POST');
    expect(last?.body).toContain('"title":"Song"');
  } finally {
    backend.stop({ ipc });
  }
});
