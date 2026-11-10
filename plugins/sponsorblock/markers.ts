// Pure marker logic: which segments the seek bar paints, and in what colour.

import { type Segment, type Submission, usableSubmissions } from "./segments.ts";

/** A segment as the seek bar paints it: the range plus its category. */
export interface Marker {
  segment: Segment;
  category: string;
}

/**
 * SponsorBlock's category colours, so the bar reads the same as in the browser
 * extension.
 */
export const CATEGORY_COLORS = {
  sponsor: "#00d400",
  selfpromo: "#ffff00",
  interaction: "#cc00ff",
  intro: "#00ffff",
  outro: "#0202ed",
  music_offtopic: "#ff9900",
} as const;

/** Unknown categories (new ones the server starts sending) get the sponsor green. */
const FALLBACK_COLOR = CATEGORY_COLORS.sponsor;

const colorOf = (category: string): string =>
  (CATEGORY_COLORS as Record<string, string | undefined>)[category] ?? FALLBACK_COLOR;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Segments to draw for media of `duration` seconds (0 = unknown), with their categories. */
export function usableMarkers(submissions: readonly Submission[], duration: number): Marker[] {
  return usableSubmissions(submissions, duration).map(({ segment, category }) => ({ segment, category }));
}

/**
 * `background-image` painting every segment over the seek track as hard colour
 * stops, or `""` when there is nothing to draw (no segments, unknown duration).
 */
export function buildSegmentsGradient(markers: readonly Marker[], duration: number): string {
  if (!Number.isFinite(duration) || duration <= 0) return "";

  // The gradient needs non-decreasing stops; the API's order is not sorted.
  const sorted = [...markers].sort((a, b) => a.segment[0] - b.segment[0]);

  const stops: string[] = [];
  for (const { segment, category } of sorted) {
    const from = clamp01(segment[0] / duration) * 100;
    const to = clamp01(segment[1] / duration) * 100;
    // Clamping can collapse a segment that sits entirely outside the track.
    if (to <= from) continue;

    const start = `${from.toFixed(2)}%`;
    const end = `${to.toFixed(2)}%`;
    const color = colorOf(category);
    stops.push(`transparent ${start}`, `${color} ${start}`, `${color} ${end}`, `transparent ${end}`);
  }

  return stops.length === 0 ? "" : `linear-gradient(to right, ${stops.join(", ")})`;
}

/** The marker painted topmost at `time`, if any (drawn later wins). */
export function markerAt(markers: readonly Marker[], time: number): Marker | undefined {
  let found: Marker | undefined;
  for (const marker of [...markers].sort((a, b) => a.segment[0] - b.segment[0])) {
    if (time >= marker.segment[0] && time < marker.segment[1]) found = marker;
  }
  return found;
}
