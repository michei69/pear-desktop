// Which provider to show. Shared by the page picker and the host RPC, so the
// lyrics tab and the API never disagree.
//
// `priority` is the user's order; providers added since the order was saved are
// appended, so a new provider is still tried. With `usePriorityList` the first
// hit in that order wins (`preferSynced` walks timed results before plain ones);
// without it the richest result wins and the order only breaks ties.

import { PROVIDERS, resultRank, type LyricResult, type ProviderId } from "./types.ts";

/** The configured order, without unknown or repeated ids, then every missing provider. */
export function resolvePriority(configured: readonly string[] | undefined): ProviderId[] {
  const known = new Set<string>(PROVIDERS);
  const order: ProviderId[] = [];
  for (const id of configured ?? []) {
    if (known.has(id) && !order.includes(id as ProviderId)) order.push(id as ProviderId);
  }
  for (const id of PROVIDERS) if (!order.includes(id)) order.push(id);
  return order;
}

export interface PickOptions {
  /** The configured order (see `resolvePriority`). */
  priority: readonly ProviderId[];
  /** Every provider's result for the track; absent while loading or on error. */
  results: Partial<Record<ProviderId, LyricResult | null>>;
  /** Follow `priority` strictly. */
  usePriorityList: boolean;
  /** Prefer time-synced over plain while walking the order. */
  preferSynced: boolean;
  /** pear-desktop's `preferredProvider`, kept for stored settings. */
  preferred?: ProviderId | "auto";
  /** A provider pinned to this song; shown whenever it has lyrics. */
  starred?: ProviderId | null;
}

/**
 * The provider to show. `starred` wins when it has lyrics; then the priority
 * list (or the preferred provider) when it has any; otherwise the richest
 * result. Never returns null when `priority` is non-empty: while nothing has
 * loaded the first provider is shown.
 */
export function pickProvider(options: PickOptions): ProviderId {
  const { priority, results, usePriorityList, preferSynced, preferred, starred } = options;
  const rank = (id: ProviderId) => resultRank(results[id]);

  if (starred && rank(starred) > 0) return starred;

  if (usePriorityList) {
    if (preferSynced) {
      const synced = priority.find((id) => rank(id) >= 2);
      if (synced) return synced;
    }
    return priority.find((id) => rank(id) > 0) ?? priority[0]!;
  }

  if (preferred && preferred !== "auto" && rank(preferred) > 0) return preferred;

  let best: ProviderId | null = null;
  let bestRank = 0;
  for (const id of priority) {
    const candidate = rank(id);
    if (candidate > bestRank) {
      best = id;
      bestRank = candidate;
    }
  }
  return best ?? priority[0]!;
}
