import type { SegmentMarker } from './types';

/**
 * SponsorBlock's category colours, so the bar reads the same as in the browser
 * extension. Unknown categories fall back to the sponsor green.
 */
export const CATEGORY_COLORS: Record<string, string> = {
  sponsor: '#00d400',
  selfpromo: '#ffff00',
  interaction: '#cc00ff',
  intro: '#00ffff',
  outro: '#0202ed',
  music_offtopic: '#ff9900',
};

const FALLBACK_COLOR = CATEGORY_COLORS.sponsor;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * `background-image` painting every segment over the seek track as hard colour
 * stops, or `''` when there is nothing to draw (no segments, unknown duration).
 */
export const buildSegmentsGradient = (
  markers: SegmentMarker[],
  duration: number,
) => {
  if (!Number.isFinite(duration) || duration <= 0) {
    return '';
  }

  // The gradient needs non-decreasing stops; the caller's order is the API's.
  const sorted = [...markers].sort(
    (markerA, markerB) => markerA.segment[0] - markerB.segment[0],
  );

  const stops: string[] = [];
  for (const { segment, category } of sorted) {
    const from = clamp01(segment[0] / duration) * 100;
    const to = clamp01(segment[1] / duration) * 100;
    // Clamping can collapse a segment that sits entirely outside the track.
    if (to <= from) continue;

    const start = `${from.toFixed(2)}%`;
    const end = `${to.toFixed(2)}%`;
    const color = CATEGORY_COLORS[category] ?? FALLBACK_COLOR;
    stops.push(
      `transparent ${start}`,
      `${color} ${start}`,
      `${color} ${end}`,
      `transparent ${end}`,
    );
  }

  return stops.length === 0
    ? ''
    : `linear-gradient(to right, ${stops.join(', ')})`;
};
