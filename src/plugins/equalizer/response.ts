import { BAND_FREQUENCIES } from './presets';

import type { EqualizerBand } from './config';

export type FrequencyPoint = {
  frequency: number;
  db: number;
};

let responseContext: OfflineAudioContext | null = null;
let probeFilters: BiquadFilterNode[] = [];

/**
 * Use Web Audio's own BiquadFilter implementation so the graph preview matches
 * what is actually heard. Probe nodes never connect to the output.
 */
export function frequencyResponse(
  bands: EqualizerBand[],
  preamp: number,
  points = 240,
): FrequencyPoint[] {
  const maxFrequency = 22050;
  const frequencies = new Float32Array(points);
  for (let index = 0; index < points; index += 1) {
    frequencies[index] =
      20 * (maxFrequency / 20) ** (index / Math.max(1, points - 1));
  }
  const result = Array.from(frequencies, (frequency) => ({
    frequency,
    db: preamp,
  }));

  try {
    responseContext ??= new OfflineAudioContext(1, 128, 48000);
    for (let index = 0; index < BAND_FREQUENCIES.length; index += 1) {
      const probe = probeFilters[index] ?? responseContext.createBiquadFilter();
      probeFilters[index] = probe;
      const band = bands[index];
      probe.type =
        index === 0
          ? 'lowshelf'
          : index === BAND_FREQUENCIES.length - 1
            ? 'highshelf'
            : 'peaking';
      probe.frequency.value = Math.min(
        23999,
        Math.max(20, band?.frequency ?? BAND_FREQUENCIES[index]),
      );
      probe.Q.value = Math.max(0.0001, band?.Q ?? Math.SQRT1_2);
      probe.gain.value = band?.gain ?? 0;
      const magnitude = new Float32Array(points);
      const phase = new Float32Array(points);
      probe.getFrequencyResponse(frequencies, magnitude, phase);
      for (let point = 0; point < points; point += 1) {
        result[point].db += 20 * Math.log10(Math.max(1e-8, magnitude[point]));
      }
    }
  } catch {
    // A browser without OfflineAudioContext (or with a closed context) still
    // gets a useful, if approximate, curve rather than an empty graph.
    for (const point of result) {
      for (let index = 0; index < BAND_FREQUENCIES.length; index += 1) {
        const band = bands[index];
        if (!band) continue;
        const octaves = Math.log2(
          Math.max(20, point.frequency) / band.frequency,
        );
        point.db += band.gain * Math.exp(-(octaves ** 2) / 0.25);
      }
    }
  }
  return result;
}

/**
 * A smooth UI curve that passes through every control dot. The audio response
 * is the sum of all biquads and can sit away from an individual band's gain
 * when neighbouring filters overlap; that makes a single summed curve look
 * disconnected from the points users are dragging. This interpolation is the
 * control curve shown by the editor, while `frequencyResponse` above remains
 * the exact DSP response helper.
 */
export function interpolatedResponse(
  bands: EqualizerBand[],
  points = 400,
): FrequencyPoint[] {
  const nodes = bands
    .map((band) => ({
      x: Math.log(Math.max(1, band.frequency)),
      y: band.gain,
    }))
    .sort((left, right) => left.x - right.x)
    .filter(
      (node, index, list) => index === 0 || node.x - list[index - 1].x > 1e-9,
    );
  if (nodes.length === 0) return [];
  if (nodes.length === 1) {
    return Array.from({ length: points }, (_, index) => ({
      frequency: 20 * (22050 / 20) ** (index / Math.max(1, points - 1)),
      db: nodes[0].y,
    }));
  }

  const intervals = nodes
    .slice(1)
    .map((node, index) => node.x - nodes[index].x);
  const deltas = nodes
    .slice(1)
    .map((node, index) => (node.y - nodes[index].y) / intervals[index]);
  const slopes = new Array<number>(nodes.length).fill(0);
  slopes[0] = deltas[0];
  slopes[nodes.length - 1] = deltas[deltas.length - 1];

  for (let index = 1; index < nodes.length - 1; index += 1) {
    const left = deltas[index - 1];
    const right = deltas[index];
    if (left * right <= 0) {
      slopes[index] = 0;
    } else {
      const leftWeight = 2 * intervals[index] + intervals[index - 1];
      const rightWeight = intervals[index] + 2 * intervals[index - 1];
      slopes[index] =
        (leftWeight + rightWeight) / (leftWeight / left + rightWeight / right);
    }
  }

  const sampleXs = new Set<number>();
  for (let index = 0; index < points; index += 1) {
    sampleXs.add(
      Math.log(20) +
        ((Math.log(22050) - Math.log(20)) * index) / Math.max(1, points - 1),
    );
  }
  for (const node of nodes) sampleXs.add(node.x);

  return [...sampleXs]
    .sort((left, right) => left - right)
    .map((x) => {
      if (x <= nodes[0].x) return { frequency: Math.exp(x), db: nodes[0].y };
      if (x >= nodes[nodes.length - 1].x) {
        return { frequency: Math.exp(x), db: nodes[nodes.length - 1].y };
      }
      let segment = 0;
      while (segment < nodes.length - 2 && x > nodes[segment + 1].x) {
        segment += 1;
      }
      const left = nodes[segment];
      const right = nodes[segment + 1];
      const h = right.x - left.x;
      const t = (x - left.x) / h;
      const t2 = t * t;
      const t3 = t2 * t;
      const db =
        (2 * t3 - 3 * t2 + 1) * left.y +
        (t3 - 2 * t2 + t) * h * slopes[segment] +
        (-2 * t3 + 3 * t2) * right.y +
        (t3 - t2) * h * slopes[segment + 1];
      return { frequency: Math.exp(x), db };
    });
}
