// Which provider to show. Shared by the page picker and the host RPC, so the
// lyrics tab and the API never disagree.
//
// `priority` is the user's provider order; providers added since the order was
// saved are appended, so a new provider is still tried. `typePriority` is the
// user's lyrics type order and is applied first: a word-by-word result wins over
// a time-synced one over a plain text block, whatever the provider order says.
// Within a type the provider order decides.

import { LYRICS_TYPES, lyricsType, PROVIDERS, type LyricResult, type LyricsType, type ProviderId } from "./types.ts";

/** The configured order, without unknown or repeated ids, then every missing entry. */
function normalizeOrder<T extends string>(configured: readonly string[] | undefined, known: readonly T[]): T[] {
  const ids = new Set<string>(known);
  const order: T[] = [];
  for (const id of configured ?? []) {
    if (ids.has(id) && !order.includes(id as T)) order.push(id as T);
  }
  for (const id of known) if (!order.includes(id)) order.push(id);
  return order;
}

/** The configured provider order, then every missing provider. */
export function resolvePriority(configured: readonly string[] | undefined): ProviderId[] {
  return normalizeOrder(configured, PROVIDERS);
}

/** The configured lyrics type order, then every missing type. */
export function resolveTypePriority(configured: readonly string[] | undefined): LyricsType[] {
  return normalizeOrder(configured, LYRICS_TYPES);
}

export interface PickOptions {
  /** The configured provider order (see `resolvePriority`). */
  priority: readonly ProviderId[];
  /** The configured type order (see `resolveTypePriority`). */
  typePriority: readonly LyricsType[];
  /** Every provider's result for the track; absent while loading or on error. */
  results: Partial<Record<ProviderId, LyricResult | null>>;
  /** Follow `priority` strictly. */
  usePriorityList: boolean;
  /** pear-desktop's `preferredProvider`, kept for stored settings. */
  preferred?: ProviderId | "auto";
  /** A provider pinned to this song; shown whenever it has lyrics. */
  starred?: ProviderId | null;
}

/** The first provider in `order` whose result has the best available type. */
function pickByType(
  order: readonly ProviderId[],
  results: PickOptions["results"],
  typePriority: readonly LyricsType[],
) {
  for (const type of typePriority) {
    const hit = order.find((id) => lyricsType(results[id]) === type);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * The provider to show. `starred` wins when it has lyrics; then the first hit
 * of the best available type in the provider order. Never returns null when
 * `priority` is non-empty: while nothing has loaded the first provider is shown.
 */
export function pickProvider(options: PickOptions): ProviderId {
  const { priority, typePriority, results, usePriorityList, preferred, starred } = options;
  const rank = (id: ProviderId) => lyricsType(results[id]) !== null;

  if (starred && rank(starred)) return starred;

  if (usePriorityList) return pickByType(priority, results, typePriority) ?? priority[0]!;

  if (preferred && preferred !== "auto" && rank(preferred)) return preferred;

  return pickByType(priority, results, typePriority) ?? priority[0]!;
}
