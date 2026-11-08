import { expect, test } from '@playwright/test';
import { Window } from 'happy-dom';

import type { MusicPlayer } from '../src/types/music-player';

type SentMessage = { channel: string; payload: unknown };

type IpcStub = {
  sent: SentMessage[];
  on: () => void;
  send: (channel: string, payload: unknown) => void;
};

const DOM_GLOBALS = [
  'document',
  'HTMLMediaElement',
  'HTMLVideoElement',
  'HTMLElement',
  'CustomEvent',
  'MutationObserver',
] as const;

const originalGlobals = new Map<string, PropertyDescriptor | undefined>();

const installDom = () => {
  const window = new Window();
  const ipc: IpcStub = {
    sent: [],
    on: () => {},
    send: (channel, payload) => {
      ipc.sent.push({ channel, payload });
    },
  };
  (window as unknown as { ipcRenderer: IpcStub }).ipcRenderer = ipc;

  for (const name of [...DOM_GLOBALS, 'window'] as const) {
    // Only the first install records the true originals: later tests replace
    // the globals again and must not save a happy-dom window as "original".
    if (!originalGlobals.has(name)) {
      originalGlobals.set(
        name,
        Object.getOwnPropertyDescriptor(globalThis, name),
      );
    }
    Object.defineProperty(globalThis, name, {
      value:
        name === 'window'
          ? window
          : name === 'document'
            ? window.document
            : (window as unknown as Record<string, unknown>)[name],
      configurable: true,
    });
  }

  return { window, ipc };
};

/** Leave the Node globals as they were: later test files share this worker. */
const restoreGlobals = () => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
  originalGlobals.clear();
};

test.afterAll(() => {
  restoreGlobals();
});

const playbackStates = (ipc: IpcStub) =>
  ipc.sent
    .filter((message) => message.channel === 'peard:play-or-paused')
    .map((message) => message.payload);

/** The slice of the player API `setupSongInfo` touches, plus a dataloaded push. */
const createPlayerApi = () => {
  const videoChangeHandlers: Array<(name: string, videoData: unknown) => void> =
    [];
  const api = {
    addEventListener: (type: string, handler: never) => {
      if (type === 'videodatachange') {
        videoChangeHandlers.push(
          handler as unknown as (name: string, videoData: unknown) => void,
        );
      }
    },
    getPlayerResponse: () => ({ videoDetails: { videoId: 'track' } }),
  } as unknown as MusicPlayer;

  const reportLoaded = () => {
    for (const handler of videoChangeHandlers) {
      handler('dataloaded', { videoId: 'track' });
    }
  };

  return { api, reportLoaded };
};

test('a session restored paused at position 0 reports the pause after a re-check', async () => {
  const { window, ipc } = installDom();

  const { setupSongInfo } = await import('../src/providers/song-info-front');
  const { api, reportLoaded } = createPlayerApi();

  const video = window.document.createElement('video');
  video.currentTime = 0;
  window.document.body.append(video);

  setupSongInfo(api);

  // The player reports the loaded track; this is what arms the media handlers.
  reportLoaded();

  // YTM's load-time pause at position 0, with no previous playing report.
  video.dispatchEvent(new window.Event('pause'));

  // The quirk pause is still vetoed immediately...
  expect(playbackStates(ipc)).toHaveLength(0);

  // ...but a video that is still paused once the load settled is a real pause.
  await new Promise((resolve) => setTimeout(resolve, 1700));
  expect(playbackStates(ipc)).toEqual([{ isPaused: true, elapsedSeconds: 0 }]);
});

test('a real pause during the re-check window is reported once', async () => {
  const { window, ipc } = installDom();

  const { setupSongInfo } = await import('../src/providers/song-info-front');
  const { api, reportLoaded } = createPlayerApi();

  const video = window.document.createElement('video');
  video.currentTime = 0;
  window.document.body.append(video);

  setupSongInfo(api);
  reportLoaded();

  // Load-time pause at position 0: vetoed, a re-check is armed.
  video.dispatchEvent(new window.Event('pause'));

  // Play, then a real pause past position 0 before the re-check fires.
  await video.play();
  video.currentTime = 5;
  video.pause();

  const expected = [
    { isPaused: false, elapsedSeconds: 0 },
    { isPaused: true, elapsedSeconds: 5 },
  ];
  expect(playbackStates(ipc)).toEqual(expected);

  // The armed re-check must not report the already-reported pause again.
  await new Promise((resolve) => setTimeout(resolve, 1700));
  expect(playbackStates(ipc)).toEqual(expected);
});
