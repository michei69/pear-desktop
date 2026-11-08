import { expect, test } from '@playwright/test';
import { Window } from 'happy-dom';

import audioCompressor from '../src/plugins/audio-compressor';
import {
  getAudioGraph,
  resetAudioGraphForTests,
} from '../src/providers/audio-graph';

type FakeParam = {
  value: number;
  linearRampToValueAtTime: () => void;
  setTargetAtTime: () => void;
};

type FakeNode = {
  mediaElement?: HTMLMediaElement;
  gain?: FakeParam;
  threshold?: FakeParam;
  ratio?: FakeParam;
  knee?: FakeParam;
  attack?: FakeParam;
  release?: FakeParam;
  connect: (to?: FakeNode) => void;
  disconnect: (to?: FakeNode) => void;
};

const fakeParam = (): FakeParam => ({
  value: 0,
  linearRampToValueAtTime: () => {},
  setTargetAtTime: () => {},
});

const fakeNode = (): FakeNode => ({
  connect: () => {},
  disconnect: () => {},
});

type Harness = {
  sources: HTMLMediaElement[];
  compressors: number;
};

const withDom = async (
  run: (window: Window, harness: Harness) => Promise<void>,
) => {
  const window = new Window();
  const previous = {
    window: (globalThis as Record<string, unknown>).window,
    document: (globalThis as Record<string, unknown>).document,
    AudioContext: (globalThis as Record<string, unknown>).AudioContext,
    MutationObserver: (globalThis as Record<string, unknown>).MutationObserver,
  };
  Object.assign(globalThis, {
    window,
    document: window.document,
    MutationObserver: window.MutationObserver,
  });

  const harness: Harness = { sources: [], compressors: 0 };
  const context = {
    currentTime: 0,
    destination: fakeNode(),
    createMediaElementSource: (element: HTMLMediaElement) => {
      harness.sources.push(element);
      return { ...fakeNode(), mediaElement: element };
    },
    createDynamicsCompressor: () => {
      harness.compressors += 1;
      return {
        ...fakeNode(),
        threshold: fakeParam(),
        ratio: fakeParam(),
        knee: fakeParam(),
        attack: fakeParam(),
        release: fakeParam(),
      };
    },
    createGain: () => ({ ...fakeNode(), gain: fakeParam() }),
  };
  globalThis.AudioContext = function () {
    return context;
  } as unknown as typeof AudioContext;

  try {
    await run(window, harness);
  } finally {
    audioCompressor.renderer.stop();
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

const makeContext = () => {
  const context = {
    ...audioCompressor.renderer,
    config: { enabled: true, autoTrackGain: false, maxTrackGainDb: 12 },
  };
  bind(context);
  return context;
};

const startContext = {
  getConfig: async () => ({
    enabled: true,
    autoTrackGain: false,
    maxTrackGainDb: 12,
  }),
  setConfig: async () => {},
  ipc: {},
};

test('an audio-can-play announcement follows the live element after a swap', async () => {
  resetAudioGraphForTests();
  await withDom(async (window, harness) => {
    // The plugin is enabled before the player exists, so its own attach path
    // has no element to resolve yet; the graph is then created on the boot
    // element by the core renderer.
    const context = makeContext();
    await context.start(startContext as never);

    const videoA = window.document.createElement('video');
    window.document.body.append(videoA);
    const graph = getAudioGraph(videoA);

    // YT swapped the element: the graph is still bound to the boot one.
    videoA.remove();
    const videoB = window.document.createElement('video');
    window.document.body.append(videoB);

    const sourcesBefore = harness.sources.length;
    window.document.dispatchEvent(
      new window.CustomEvent('peard:audio-can-play', {
        detail: { audioContext: graph.context, audioSource: graph.source },
      }),
    );

    // The announcement still carries the boot element's source; the chain must
    // be rebuilt on the element that is actually in the document.
    expect(harness.sources.slice(sourcesBefore)).toEqual([videoB]);
  });
});

test('a re-enable attaches to the element that is live then', async () => {
  resetAudioGraphForTests();
  await withDom(async (window, harness) => {
    const context = makeContext();
    await context.start(startContext as never);

    const videoA = window.document.createElement('video');
    window.document.body.append(videoA);
    getAudioGraph(videoA);
    await context.start(startContext as never);
    expect(harness.compressors).toBeGreaterThan(0);

    // Disabled: the chain must not claim to be attached to anything.
    context.stop();

    videoA.remove();
    const videoB = window.document.createElement('video');
    window.document.body.append(videoB);

    const sourcesBefore = harness.sources.length;
    await context.start(startContext as never);

    expect(harness.sources.slice(sourcesBefore)).toEqual([videoB]);
  });
});
