// The page-local stores: the slim matching cache, names for the settings search,
// recent matches and feedback already sent. None of it belongs in the plugin
// config, which changes far less often.

import { CACHE_KEY, CACHE_TTL_MS } from "./config.ts";
import { type Blacklist, isBlacklist } from "./filter.ts";

export interface RecentEntry {
  id: string;
  name: string;
  reason: string;
}

const RECENT_KEY = "skip-ai-slop:recent";
const RECENT_MAX = 60;

export interface BlacklistName {
  id: string;
  name: string;
  kind: "channel" | "track";
  lower: string;
  idLower: string;
}

interface NamedEntry {
  name?: string;
  title?: string;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

let recentCache: RecentEntry[] | null = null;
let namesCache: BlacklistName[] | null = null;

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
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    // ignore
  }
};

export const NAMES_KEY = "skip-ai-slop:blacklist-names";

/** Saves { id: name } for channels and { id: title } for tracks. */
export const writeBlacklistNames = (data: { channels?: Record<string, NamedEntry>; tracks?: Record<string, NamedEntry> }) => {
  namesCache = null;
  const channels: Record<string, string> = {};
  for (const [id, entry] of Object.entries(data.channels ?? {})) channels[id] = entry?.name ?? "";
  const tracks: Record<string, string> = {};
  for (const [id, entry] of Object.entries(data.tracks ?? {})) tracks[id] = entry?.title ?? entry?.name ?? "";
  writeJson(NAMES_KEY, { channels, tracks });
};

export const hasBlacklistNames = () => {
  try {
    return localStorage.getItem(NAMES_KEY) !== null;
  } catch {
    return false;
  }
};

/** Parsed once and kept; an empty result is not cached, so names that arrive later are picked up. */
export const readBlacklistNames = (): BlacklistName[] => {
  if (namesCache?.length) return namesCache;
  const names: BlacklistName[] = [];
  const parsed = asRecord(readJson(NAMES_KEY));
  for (const kind of ["channel", "track"] as const) {
    const group = asRecord(parsed?.[kind === "channel" ? "channels" : "tracks"]);
    if (!group) continue;
    for (const [id, value] of Object.entries(group)) {
      const name = typeof value === "string" && value ? value : id;
      names.push({ id, name, kind, lower: name.toLowerCase(), idLower: id.toLowerCase() });
    }
  }
  if (names.length) namesCache = names;
  return names;
};

/** The community-list entries whose name or id contains `query`, name matches first. */
export const searchBlacklistNames = (query: string, limit = 10): BlacklistName[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return readBlacklistNames()
    .filter((entry) => entry.lower.includes(needle) || entry.idLower.includes(needle))
    .sort((a, b) => Number(b.lower.startsWith(needle)) - Number(a.lower.startsWith(needle)) || a.lower.localeCompare(b.lower))
    .slice(0, limit);
};

export const clearBlacklistNames = () => {
  namesCache = null;
  try {
    localStorage.removeItem(NAMES_KEY);
  } catch {
    // ignore
  }
};

export interface CachedBlacklist {
  data: Blacklist;
  /** False when the cache is older than its TTL but still usable. */
  fresh: boolean;
}

/** Reads the downloaded list synchronously, so it is usable the moment the page starts. */
export const readCachedBlacklist = (): CachedBlacklist | null => {
  const parsed = asRecord(readJson(CACHE_KEY));
  const data = parsed?.data;
  if (!isBlacklist(data)) return null;
  const timestamp = parsed?.ts;
  return {
    data,
    fresh: typeof timestamp === "number" && Date.now() - timestamp < CACHE_TTL_MS,
  };
};

export const writeCachedBlacklist = (data: Blacklist) => {
  writeJson(CACHE_KEY, { data, ts: Date.now() });
};

export const clearCachedBlacklist = () => {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
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
  try {
    localStorage.removeItem(FEEDBACK_KEY);
  } catch {
    // ignore
  }
};

/** "Clear cache" in the settings: the matching cache, names, matches and feedback history. */
export const clearPluginStorage = () => {
  clearCachedBlacklist();
  clearBlacklistNames();
  clearRecent();
  clearFeedbackDone();
};
