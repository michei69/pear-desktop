// The page-local stores: the slim matching cache, recent matches and feedback
// already sent. None of it belongs in the plugin config, which changes far less often.

import { CACHE_KEY, CACHE_TTL_MS } from "./config.ts";
import { type Blacklist, isBlacklist } from "./filter.ts";

export interface RecentEntry {
  id: string;
  name: string;
  reason: string;
}

const RECENT_KEY = "skip-ai-slop:recent";
const RECENT_MAX = 60;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

let recentCache: RecentEntry[] | null = null;

const readJson = (key: string): unknown => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable: the in-memory copy still works for this session.
  }
};

const removeKey = (key: string) => {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
};

export const readRecentFiltered = (): RecentEntry[] => {
  if (recentCache) return recentCache;
  const raw = readJson(RECENT_KEY);
  recentCache = Array.isArray(raw)
    ? raw.flatMap((item) => {
        const entry = asRecord(item);
        const id = entry?.id;
        const name = entry?.name;
        const reason = entry?.reason;
        return typeof id === "string" && typeof name === "string" && typeof reason === "string" ? [{ id, name, reason }] : [];
      })
    : [];
  return recentCache;
};

export const recordFiltered = (entry: RecentEntry) => {
  const list = readRecentFiltered();
  if (list.some((candidate) => candidate.id === entry.id)) return;
  recentCache = [entry, ...list].slice(0, RECENT_MAX);
  writeJson(RECENT_KEY, recentCache);
};

export const clearRecent = () => {
  recentCache = [];
  removeKey(RECENT_KEY);
};

/** Forgets one match, so a fixed or dismissed false positive drops off the list. */
export const removeRecent = (id: string) => {
  recentCache = readRecentFiltered().filter((entry) => entry.id !== id);
  writeJson(RECENT_KEY, recentCache);
};

export interface CachedBlacklist {
  data: Blacklist;
  /** False when the cache is older than its TTL but still usable. */
  fresh: boolean;
}

// The multi-megabyte list is parsed once per stored value, not on every
// refreshTick/load/change; `fresh` is still computed per call.
let cacheRaw: string | null | undefined;
let cacheData: Blacklist | null = null;
let cacheTs: number | undefined;

/** Reads the downloaded list synchronously, so it is usable the moment the page starts. */
export const readCachedBlacklist = (): CachedBlacklist | null => {
  let raw: string | null;
  try {
    raw = localStorage.getItem(CACHE_KEY);
  } catch {
    return null;
  }
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    cacheData = null;
    cacheTs = undefined;
    try {
      const parsed = asRecord(raw ? JSON.parse(raw) : null);
      if (isBlacklist(parsed?.data)) {
        cacheData = parsed.data;
        cacheTs = typeof parsed.ts === "number" ? parsed.ts : undefined;
      }
    } catch {
      // A corrupt cache reads as missing; the next download replaces it.
    }
  }
  if (!cacheData) return null;
  return {
    data: cacheData,
    fresh: cacheTs !== undefined && Date.now() - cacheTs < CACHE_TTL_MS,
  };
};

export const writeCachedBlacklist = (data: Blacklist) => {
  writeJson(CACHE_KEY, { data, ts: Date.now() });
  cacheRaw = undefined;
};

export const clearCachedBlacklist = () => {
  removeKey(CACHE_KEY);
  cacheRaw = undefined;
};

const FEEDBACK_KEY = "skip-ai-slop:feedback-done";

export const loadFeedbackDone = (): Set<string> => {
  const stored = readJson(FEEDBACK_KEY);
  return new Set(Array.isArray(stored) ? stored.filter((key): key is string => typeof key === "string") : []);
};

export const saveFeedbackDone = (done: ReadonlySet<string>) => {
  writeJson(FEEDBACK_KEY, [...done].slice(-2000));
};

export const clearFeedbackDone = () => {
  removeKey(FEEDBACK_KEY);
};

/** "Clear saved data" in the settings: the matching cache, recent matches and feedback history. */
export const clearPluginStorage = () => {
  clearCachedBlacklist();
  clearRecent();
  clearFeedbackDone();
};
