import type { EqualizerBand } from './config';

export type FrequencyPoint = {
  frequency: number;
  db: number;
};

/**
 * A smooth UI curve that passes through every control dot. The audio response
 * is the sum of all biquads and can sit away from an individual band's gain
 * when neighbouring filters overlap; that makes a single summed curve look
 * disconnected from the points users are dragging, so the editor draws this
 * control curve instead.
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
