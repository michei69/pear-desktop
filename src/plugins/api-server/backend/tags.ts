/**
 * Swagger UI renders one collapsible section per OpenAPI tag, and files every
 * untagged operation under a fallback "default" section — which is where all 79
 * routes used to land, v1 and v2 interleaved.
 *
 * Tags are flat, so the version is part of the tag name rather than a parent
 * group. `apiTagOrder` is what makes the sections read version-first, then
 * category: Swagger shows them in the order the document declares them.
 */

const V1_CATEGORIES = [
  'Playback',
  'Rating',
  'Shuffle & repeat',
  'Volume & fullscreen',
  'Song',
  'Queue',
  'Search & navigation',
  'WebSocket',
] as const;

const V2_CATEGORIES = [
  'Video',
  'Playback',
  'Volume',
  'Rating',
  'Queue',
  'WebSocket',
] as const;

/**
 * `v1 · Playback` — the version is part of the tag because tags don't nest.
 * Taking the category as a union keeps a typo from silently creating a second
 * section next to the real one.
 */
export const v1Tag = (category: (typeof V1_CATEGORIES)[number]) =>
  `v1 · ${category}`;

export const v2Tag = (category: (typeof V2_CATEGORIES)[number]) =>
  `v2 · ${category}`;

/** `POST /auth/{id}` sits outside any version, so it gets an unversioned tag. */
export const AUTH_TAG = 'Auth';

/** Every tag, version-first then category, in the order Swagger should show. */
export const apiTagOrder = [
  ...V1_CATEGORIES.map(v1Tag),
  ...V2_CATEGORIES.map(v2Tag),
  AUTH_TAG,
];
