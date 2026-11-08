import { expect, test } from '@playwright/test';
import { Window } from 'happy-dom';

import { renderer as customOutputDevice } from '../src/plugins/custom-output-device/renderer';
import { resetAudioGraphForTests } from '../src/providers/audio-graph';

type FakeNode = {
  mediaElement?: HTMLMediaElement;
  connect: () => void;
  disconnect: () => void;
};

const fakeNode = (mediaElement?: HTMLMediaElement): FakeNode => ({
  mediaElement,
  connect: () => {},
  disconnect: () => {},
});

const withDom = async (
  run: (window: Window, sinkCalls: string[]) => Promise<void>,
) => {
  const window = new Window();
  const previous = {
    window: (globalThis as Record<string, unknown>).window,
    document: (globalThis as Record<string, unknown>).document,
    AudioContext: (globalThis as Record<string, unknown>).AudioContext,
  };
  Object.assign(globalThis, {
    window,
    document: window.document,
  });

  const sinkCalls: string[] = [];
  const context = {
    currentTime: 0,
    destination: fakeNode(),
    createMediaElementSource: (element: HTMLMediaElement) => fakeNode(element),
    setSinkId: async (sinkId: string) => {
      sinkCalls.push(sinkId);
    },
  };
  globalThis.AudioContext = function () {
    return context;
  } as unknown as typeof AudioContext;

  try {
    await run(window, sinkCalls);
  } finally {
    Object.assign(globalThis, previous);
    resetAudioGraphForTests();
    window.happyDOM.close();
  }
};

const bind = (context: object) => {
  for (const [key, value] of Object.entries(context)) {
    if (typeof value === 'function') {
      (context as Record<string, unknown>)[key] = value.bind(context);
    }
  }
};

test('enabling while a track is loaded applies the sink without a new track', async () => {
  resetAudioGraphForTests();
  await withDom(async (window, sinkCalls) => {
    window.document.body.innerHTML = '<video></video>';

    const context = {
      ...customOutputDevice,
      options: {
        enabled: true,
        output: 'speaker-2',
        devices: [],
      },
    };
    bind(context);

    // No `peard:audio-can-play` was ever dispatched for this session: the
    // one-shot listener alone used to leave the sink unapplied until the next
    // track.
    await context.onPlayerApiReady();

    expect(sinkCalls).toEqual(['speaker-2']);

    // A config change is applied on the captured context.
    await context.onConfigChange({
      enabled: true,
      output: 'speaker-3',
      devices: [],
    });
    expect(sinkCalls).toEqual(['speaker-2', 'speaker-3']);
  });
});

test('without a video element the hook waits for the next track', async () => {
  resetAudioGraphForTests();
  await withDom(async (window, sinkCalls) => {
    window.document.body.innerHTML = '<div></div>';

    const context = {
      ...customOutputDevice,
      options: { enabled: true, output: 'speaker-2', devices: [] },
    };
    bind(context);

    await context.onPlayerApiReady();

    expect(sinkCalls).toEqual([]);
  });
});
