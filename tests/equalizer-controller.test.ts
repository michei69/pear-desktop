import { expect, test } from '@playwright/test';

import { flatProfile, normalizeConfig } from '../src/plugins/equalizer/config';
import { EqualizerAudioChain } from '../src/plugins/equalizer/controller';
import { getAudioGraph } from '../src/providers/audio-graph';

type Param = AudioParam & { value: number };
type FakeNode = AudioNode & {
  edges: Set<FakeNode>;
  type?: BiquadFilterType;
  frequency?: Param;
  Q?: Param;
  gain?: Param;
};

const param = (value: number): Param =>
  ({
    value,
    cancelAndHoldAtTime() {},
    setTargetAtTime(next: number) {
      this.value = next;
    },
  }) as unknown as Param;

const fakeNode = (): FakeNode => {
  const node = {
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

const fakeFilter = (): FakeNode => {
  const filter = fakeNode();
  filter.type = 'peaking';
  filter.frequency = param(1000);
  filter.Q = param(1);
  filter.gain = param(0);
  return filter;
};

const fakeGain = (): FakeNode => {
  const gain = fakeNode();
  gain.gain = param(1);
  return gain;
};

const destination = fakeNode();
const created: FakeNode[] = [];
const context = {
  currentTime: 1,
  sampleRate: 48000,
  destination,
  createMediaElementSource: () => fakeNode(),
  createBiquadFilter: () => {
    const filter = fakeFilter();
    created.push(filter);
    return filter;
  },
  createGain: () => {
    const gain = fakeGain();
    created.push(gain);
    return gain;
  },
} as unknown as AudioContext;
(globalThis as Record<string, unknown>).AudioContext = function () {
  return context;
};

test('the equalizer owns one serial chain and updates gain in place', () => {
  const source = getAudioGraph({} as HTMLVideoElement).source as FakeNode;
  const chain = new EqualizerAudioChain();
  chain.connect(source, context);
  chain.apply(
    normalizeConfig({
      filters: flatProfile().filters,
      outputGainDb: 0,
    }),
  );

  const filters = created.filter((node) => node.frequency);
  const output = created.find((node) => node.gain && !node.frequency)!;
  expect(filters).toHaveLength(11);
  expect([...source.edges]).toEqual([filters[0]]);
  expect([...filters[10].edges]).toEqual([output]);
  expect([...output.edges]).toEqual([destination]);

  chain.apply(
    normalizeConfig({
      filters: flatProfile().filters.map((band, index) => ({
        ...band,
        gain: index === 5 ? 6 : 0,
      })),
      outputGainDb: -3,
    }),
  );
  expect(filters[5].gain?.value).toBe(6);
  expect(output.gain?.value).toBeCloseTo(10 ** (-3 / 20), 5);

  chain.stop();
  expect([...source.edges]).toEqual([destination]);
  expect(filters.every((filter) => filter.edges.size === 0)).toBe(true);
});
