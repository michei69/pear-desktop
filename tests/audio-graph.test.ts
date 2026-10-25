import { expect, test } from '@playwright/test';

import {
  clearAudioChain,
  getAudioGraph,
  rebindAudioGraphSource,
  resetAudioGraphForTests,
  setAudioChain,
} from '../src/providers/audio-graph';

/** A real `AudioNode` on the API surface, with an inspectable edge set. */
type FakeNode = AudioNode & {
  mediaElement?: unknown;
  edges: Set<FakeNode>;
};

type FakeAudioContext = AudioContext & {
  destination: FakeNode;
  createMediaElementSource: (el: unknown) => FakeNode;
  created: FakeNode[];
};

const fakeNode = (mediaElement?: unknown): FakeNode => {
  const node = {
    mediaElement,
    edges: new Set<FakeNode>(),
    connect(to: FakeNode) {
      node.edges.add(to);
      return to;
    },
    disconnect(to?: FakeNode) {
      if (to) node.edges.delete(to);
      else node.edges.clear();
    },
  };
  return node as unknown as FakeNode;
};

const fakeContext = (): FakeAudioContext => {
  const created: FakeNode[] = [];
  const context = {
    destination: fakeNode(),
    createMediaElementSource: (el: unknown) => {
      const source = fakeNode(el);
      created.push(source);
      return source;
    },
    created,
  };
  return context as unknown as FakeAudioContext;
};

// The owner is module-global and Playwright reuses a worker across test files,
// so start from no graph instead of inheriting one an earlier file created.
const ctx = fakeContext();
resetAudioGraphForTests();
(globalThis as Record<string, unknown>).AudioContext = function () {
  return ctx;
};

test('the audio-graph owner keeps one source-to-destination path', () => {
  // No consumer: the plain path.
  const source = getAudioGraph({} as HTMLVideoElement).source as FakeNode;
  expect([...source.edges]).toEqual([ctx.destination]);

  // One consumer.
  const aIn = fakeNode();
  const aOut = fakeNode();
  setAudioChain('a', aIn, aOut);
  expect([...source.edges]).toEqual([aIn]);
  expect([...aOut.edges]).toEqual([ctx.destination]);

  // Two consumers: one path, never `source → dest` in parallel with a chain —
  // that is the double-audio / lost-edge bug the owner exists to prevent.
  const bIn = fakeNode();
  const bOut = fakeNode();
  setAudioChain('b', bIn, bOut);
  expect([...source.edges]).toEqual([aIn]);
  expect([...aOut.edges]).toEqual([bIn]);
  expect([...bOut.edges]).toEqual([ctx.destination]);

  // Re-registering must not stack edges.
  for (let i = 0; i < 5; i++) {
    setAudioChain('a', aIn, aOut);
    expect(source.edges.size).toBe(1);
    expect(aOut.edges.size).toBe(1);
    expect(bOut.edges.size).toBe(1);
  }

  // Removing one consumer leaves the rest of the path intact.
  clearAudioChain('a');
  expect([...source.edges]).toEqual([bIn]);
  expect([...bOut.edges]).toEqual([ctx.destination]);

  // A video swap moves the whole path to the new source.
  const swapped = rebindAudioGraphSource({} as HTMLVideoElement) as FakeNode;
  expect(swapped).not.toBe(source);
  expect(source.edges.size).toBe(0);
  expect([...swapped.edges]).toEqual([bIn]);
  expect([...bOut.edges]).toEqual([ctx.destination]);

  // The same element again is not a swap.
  expect(rebindAudioGraphSource(swapped.mediaElement as HTMLVideoElement)).toBe(
    null,
  );
  expect(ctx.created.length).toBe(2);

  // Empty again: the default path returns.
  clearAudioChain('b');
  expect([...swapped.edges]).toEqual([ctx.destination]);
});
