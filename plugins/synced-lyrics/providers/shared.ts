/** Payload strings are untrusted, so only real strings are kept. */
export const textOf = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Artist names as displayed, e.g. `ROSÉ, Bruno Mars` -> two artists. */
export const splitArtists = (artists: string) =>
  artists
    .split(/[&,]|\s+(?:feat\.?|ft\.?)\s+/i)
    .map((artist) => artist.trim())
    .filter(Boolean);

const NOISE_TAG_PATTERN =
  /\s*[([](?:video\s+oficial|v[ií]deo\s+oficial|letra\s+oficial|video\s+musical|audio\s+oficial|lyric\s+video|official\s+[^)\]]*|visualizer)[)\]]/gi;

/** Video-title noise ("Song (Official Video)") confuses the full-text search. */
export function cleanTrackTitle(rawTitle: string): string {
  const cleaned = (rawTitle.replace(NOISE_TAG_PATTERN, "").split(" | ")[0] ?? "").trim();
  return cleaned || rawTitle;
}
