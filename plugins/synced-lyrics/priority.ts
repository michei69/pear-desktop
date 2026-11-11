// Which provider to show. Shared by the page picker and the host RPC, so the
// lyrics tab and the API never disagree.
//
// `priority` is the user's provider order; providers added since the order was
// saved are appended, so a new provider is still tried. `typePriority` is the
// user's lyrics type order and is applied first: a word-by-word result wins over
// a time-synced one over a plain text block, whatever the provider order says.
// Within a type, the order decides -- or, when the priority list is off, the
// result quality (pear-desktop's bias), with the preferred provider breaking ties.

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
  /** A Chinese translation target prefers providers that ship the official translation. */
  wantsOfficialTranslation?: boolean;
}

/** pear-desktop's quality bias: richer results (and an official translation) first. */
function orderByBias(priority: readonly ProviderId[], results: PickOptions["results"], wantsOfficialTranslation: boolean): ProviderId[] {
  const bias = (provider: ProviderId) => {
    const result = results[provider] ?? null;
    const synced = Boolean(result?.lines?.some((line) => line.text.trim()));
    const plain = Boolean(result?.plain?.trim());
    const wordSynced = Boolean(result?.lines?.some((line) => line.words?.length));
    const officialTranslation = Boolean(result?.translation?.lines?.some((line) => line.text.trim()) || result?.translation?.plain?.trim());
    return (
      (result ? 1 : -1) +
      (lyricsType(result) ? 2 : -2) +
      (officialTranslation && wantsOfficialTranslation ? 3 : 0) +
      (synced ? 2 : -1) +
      (wordSynced ? 2 : 0) +
      (synced && provider === "YTMusic" ? 1 : 0) +
      (plain ? 1 : -1)
    );
  };
  return [...priority].sort((a, b) => bias(b) - bias(a));
}

/** The first provider in `order` whose result has the best available type. */
function pickByType(order: readonly ProviderId[], results: PickOptions["results"], typePriority: readonly LyricsType[]) {
  for (const type of typePriority) {
    const hit = order.find((id) => lyricsType(results[id]) === type);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * The provider to show. `starred` wins when it has lyrics; then the best
 * available type in the type order. With the priority list off the providers
 * are ranked by result quality first, so a richer result beats a stored order;
 * the preferred provider only breaks ties between equally timed results.
 * Never returns null when `priority` is non-empty: while nothing has loaded the
 * first provider is shown.
 */
export function pickProvider(options: PickOptions): ProviderId {
  const { priority, typePriority, results, usePriorityList, preferred, starred } = options;
  const rank = (id: ProviderId) => lyricsType(results[id]) !== null;

  if (starred && rank(starred)) return starred;

  const ranked = usePriorityList ? priority : orderByBias(priority, results, options.wantsOfficialTranslation ?? false);
  const best = pickByType(ranked, results, typePriority);
  if (best) {
    if (!usePriorityList && preferred && preferred !== "auto" && lyricsType(results[preferred]) === lyricsType(results[best])) {
      return preferred;
    }
    return best;
  }

  if (!usePriorityList && preferred && preferred !== "auto" && rank(preferred)) return preferred;

  return ranked[0]!;
}
