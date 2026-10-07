// Copyright (c) 2026 bwedirhan. MIT License.
export type KeywordEntry = { text: string; enabled: boolean };
export type ChannelEntry = { id: string; name: string };

export type SkipAiSlopConfig = {
  enabled: boolean;
  userAllow: ChannelEntry[]; // channels that are never filtered (always wins)
  userBlock: ChannelEntry[]; // channels that are always filtered
  keywords: KeywordEntry[]; // filter when title or channel name contains one
  reportFeedback: boolean; // send YouTube "not interested" for flagged recommendation cards
  hideInPages: boolean; // hide flagged results on every page (search, home, lists)
};

export const defaultConfig: SkipAiSlopConfig = {
  enabled: false,
  userAllow: [],
  userBlock: [],
  keywords: [],
  reportFeedback: false,
  hideInPages: true,
};

/** Tolerates missing / old-format values (plain strings) in a stored config. */
export const normalizeKeywords = (raw: unknown): KeywordEntry[] => {
  if (!Array.isArray(raw)) return [];
  const out: KeywordEntry[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      out.push({ text: item.trim(), enabled: true });
    } else if (item && typeof item.text === 'string' && item.text.trim()) {
      out.push({ text: item.text.trim(), enabled: item.enabled !== false });
    }
  }
  return out;
};

/**
 * Turns a keyword into a matcher that finds it as a WHOLE word (or phrase),
 * case-insensitively: "ai" matches "AI Cover" but not "Mai" or "Tchaikovsky".
 * Shared by index.ts and early.ts so both judge keywords the same way.
 * The regex has no `g` flag, so `.test()` keeps no state between calls.
 */
export const compileKeyword = (text: string): RegExp | null => {
  const t = text.trim();
  if (!t) return null;
  const body = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const edge = '[\\p{L}\\p{N}]';
  return new RegExp(`(?<!${edge})${body}(?!${edge})`, 'iu');
};

/** Enabled keywords of a stored config, compiled. */
export const compileKeywords = (raw: unknown): RegExp[] =>
  normalizeKeywords(raw)
    .filter((k) => k.enabled)
    .map((k) => compileKeyword(k.text))
    .filter((r): r is RegExp => !!r);

/** Accepts old plain-ID strings as well as { id, name } entries. */
export const normalizeChannels = (raw: unknown): ChannelEntry[] => {
  if (!Array.isArray(raw)) return [];
  const out: ChannelEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id = typeof item === 'string' ? item : item?.id;
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: typeof item?.name === 'string' && item.name ? item.name : id,
    });
  }
  return out;
};

// ---- recently filtered channels (shown in settings so false positives can be
// allowed with one click). Kept in localStorage: it changes on every scan and
// does not belong in the plugin config.
export type RecentEntry = { id: string; name: string; reason: string };
const RECENT_KEY = 'skip-ai-slop:recent';
const RECENT_MAX = 60;
let recentCache: RecentEntry[] | null = null;

export const readRecentFiltered = (): RecentEntry[] => {
  if (recentCache) return recentCache;
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    recentCache = Array.isArray(raw) ? raw : [];
  } catch {
    recentCache = [];
  }
  return recentCache!;
};

export const recordFiltered = (entry: RecentEntry) => {
  const list = readRecentFiltered();
  if (list.some((e) => e.id === entry.id)) return; // only writes when something is new
  recentCache = [entry, ...list].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentCache));
  } catch {
    /* ignore */
  }
};

export const forgetFiltered = (id: string) => {
  recentCache = readRecentFiltered().filter((e) => e.id !== id);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentCache));
  } catch {
    /* ignore */
  }
};

// ---- names of the downloaded community list (for the "Search the community
// list" setting). The matching cache (skip-ai-slop:blacklist) keeps IDs only, so
// it stays small and quick to parse at startup (index.ts and early.ts both read
// it). Names live in this separate store, which only the settings search reads,
// lazily and once.
export const NAMES_KEY = 'skip-ai-slop:blacklist-names';

export type BlacklistName = {
  id: string;
  name: string; // falls back to the id when the list has no name
  kind: 'channel' | 'track';
  lower: string; // lower-cased name, for searching
  idLower: string;
};

type NamedEntry = { name?: string; title?: string };
let namesCache: BlacklistName[] | null = null;

/** Saves { id: name } for channels and { id: title } for tracks. */
export const writeBlacklistNames = (data: {
  channels?: Record<string, NamedEntry>;
  tracks?: Record<string, NamedEntry>;
}) => {
  namesCache = null;
  try {
    const channels: Record<string, string> = {};
    for (const [id, e] of Object.entries(data.channels ?? {})) {
      channels[id] = e?.name ?? '';
    }
    const tracks: Record<string, string> = {};
    for (const [id, e] of Object.entries(data.tracks ?? {})) {
      tracks[id] = e?.title ?? e?.name ?? '';
    }
    localStorage.setItem(NAMES_KEY, JSON.stringify({ channels, tracks }));
  } catch {
    /* storage full or unavailable: search just stays empty */
  }
};

export const hasBlacklistNames = (): boolean => {
  try {
    return localStorage.getItem(NAMES_KEY) !== null;
  } catch {
    return false;
  }
};

/** Parsed once and kept in memory; an empty result is not cached, so names that arrive later are picked up. */
export const readBlacklistNames = (): BlacklistName[] => {
  if (namesCache?.length) return namesCache;
  const out: BlacklistName[] = [];
  try {
    const raw = localStorage.getItem(NAMES_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    for (const kind of ['channel', 'track'] as const) {
      const group = parsed?.[kind === 'channel' ? 'channels' : 'tracks'];
      if (!group || typeof group !== 'object') continue;
      for (const [id, n] of Object.entries(group)) {
        const name = typeof n === 'string' && n ? n : id;
        out.push({
          id,
          name,
          kind,
          lower: name.toLowerCase(),
          idLower: id.toLowerCase(),
        });
      }
    }
  } catch {
    /* ignore a corrupt store */
  }
  if (out.length) namesCache = out;
  return out;
};

/** Removes the saved names (used by "Clear cache"). */
export const clearBlacklistNames = () => {
  namesCache = null;
  try {
    localStorage.removeItem(NAMES_KEY);
  } catch {
    /* ignore */
  }
};

// ---- messages between the "Community list" settings buttons and index.ts.
// The settings component cannot import index.ts (index.ts imports it), so the
// two talk through window events.
export const EVT_DOWNLOAD = 'skip-ai-slop:download'; // settings -> plugin
export const EVT_CLEAR = 'skip-ai-slop:clear-cache'; // settings -> plugin
export const EVT_INFO = 'skip-ai-slop:info-request'; // settings -> plugin
export const EVT_STATUS = 'skip-ai-slop:status'; // plugin -> settings
export type ListStatus = { text: string; busy: boolean };

/**
 * Names of allowed channels, lower-cased, for allowing by name. A channel can
 * have more than one id (the community list may hold one while YouTube Music
 * shows another), so an id alone is not enough to honour "Allow". Entries whose
 * name is just their id are left out.
 */
export const allowedNames = (raw: unknown): Set<string> =>
  new Set(
    normalizeChannels(raw)
      .filter((c) => c.name !== c.id)
      .map((c) => c.name.trim().toLowerCase())
      .filter(Boolean),
  );
