// What counts as "AI slop", with no DOM and no storage: user lists, keywords,
// the downloaded community list, and the one decision both the early scanner and
// the full page scan ask for. Allow always wins.

export interface KeywordEntry {
  text: string;
  enabled: boolean;
}

export interface BlacklistEntry {
  name?: string;
  title?: string;
  reason?: string;
  added_at?: string;
}

export interface Blacklist {
  version: number;
  updated_at: string;
  channels: Record<string, BlacklistEntry>;
  tracks: Record<string, BlacklistEntry>;
}

export interface Rules {
  allowIds: Set<string>;
  /** Lower-cased exact channel names the user allowed. */
  allowNames: Set<string>;
  blockIds: Set<string>;
  blockNames: Set<string>;
  /** Whole-word matchers, case-insensitive. */
  keywords: RegExp[];
  /** Community list ids. */
  channels: Set<string>;
  tracks: Set<string>;
  /** Artists learned from a flagged uploader during this page session. */
  session: Set<string>;
}

export interface RuleSource {
  userAllow: readonly string[];
  userBlock: readonly string[];
  keywords: readonly string[];
  communityList: boolean;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** Tolerates a stored list that still holds `{ text, enabled }` entries. */
export const normalizeKeywords = (raw: unknown): KeywordEntry[] => {
  if (!Array.isArray(raw)) return [];
  const entries: KeywordEntry[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const text = item.trim();
      if (text) entries.push({ text, enabled: true });
      continue;
    }

    const entry = asRecord(item);
    const rawText = entry?.text;
    const text = typeof rawText === "string" ? rawText.trim() : "";
    if (text) entries.push({ text, enabled: entry?.enabled !== false });
  }
  return entries;
};

/**
 * Matches a keyword as a WHOLE word (or phrase), case-insensitively: "ai" hits
 * "AI Cover" but not "Mai" or "Tchaikovsky". No `g` flag, so `.test()` keeps no
 * state between calls.
 */
export const compileKeyword = (text: string): RegExp | null => {
  const value = text.trim();
  if (!value) return null;
  const body = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const edge = "[\\p{L}\\p{N}]";
  return new RegExp(`(?<!${edge})${body}(?!${edge})`, "iu");
};

export const compileKeywords = (raw: unknown): RegExp[] =>
  normalizeKeywords(raw)
    .filter((entry) => entry.enabled)
    .map((entry) => compileKeyword(entry.text))
    .filter((regex): regex is RegExp => !!regex);

/** A channel id, as opposed to a channel name; anything else is matched by name. */
const looksLikeId = (value: string) => /^UC[\w-]{22}$/.test(value);

/** Turns a settings list into the ids and the exact names it names. */
const splitUserList = (raw: readonly string[]) => {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const value of raw) {
    const item = value.trim();
    if (!item) continue;
    if (looksLikeId(item)) ids.add(item);
    else names.add(item.toLowerCase());
  }
  return { ids, names };
};

export const isBlacklist = (value: unknown): value is Blacklist => {
  const data = asRecord(value);
  return !!data && data.version === 2 && !!asRecord(data.channels) && !!asRecord(data.tracks);
};

/** Matching needs only the ids; names and reasons would make the cache large. */
export const slimBlacklist = (data: Blacklist): Blacklist => {
  const keysOnly = (record: Record<string, BlacklistEntry>) =>
    Object.fromEntries(Object.keys(record).map((key) => [key, {} as BlacklistEntry]));
  return {
    version: data.version,
    updated_at: data.updated_at,
    channels: keysOnly(data.channels),
    tracks: keysOnly(data.tracks),
  };
};

export const buildRules = (source: RuleSource, list: Blacklist | null, session: Set<string> = new Set()): Rules => {
  const allow = splitUserList(source.userAllow);
  const block = splitUserList(source.userBlock);
  const community = source.communityList ? list : null;
  return {
    allowIds: allow.ids,
    allowNames: allow.names,
    blockIds: block.ids,
    blockNames: block.names,
    keywords: compileKeywords(source.keywords),
    channels: new Set(community ? Object.keys(community.channels) : []),
    tracks: new Set(community ? Object.keys(community.tracks) : []),
    session,
  };
};

export interface CardIdentity {
  videoId: string | undefined;
  channelIds: readonly string[];
  title: string | undefined;
  author: string | undefined;
}

const lowered = (value?: string) => value?.trim().toLowerCase() ?? "";

/** The reason a track is flagged, or null when it plays. Allow wins over everything. */
export const decide = (rules: Rules, card: CardIdentity): string | null => {
  const channelIds = card.channelIds ?? [];
  const ids = [card.videoId, ...channelIds].filter((id): id is string => !!id);

  if (ids.some((id) => rules.allowIds.has(id)) || rules.allowNames.has(lowered(card.title)) || rules.allowNames.has(lowered(card.author))) {
    return null;
  }
  if (ids.some((id) => rules.blockIds.has(id)) || rules.blockNames.has(lowered(card.title)) || rules.blockNames.has(lowered(card.author))) {
    return "user-block";
  }
  if (ids.some((id) => rules.session.has(id))) return "learned-artist";

  const title = card.title;
  const author = card.author;
  if (title && rules.keywords.some((keyword) => keyword.test(title))) return "keyword:title";
  if (author && rules.keywords.some((keyword) => keyword.test(author))) return "keyword:author";

  if (channelIds.some((id) => rules.channels.has(id))) return "channel";
  if (card.videoId && rules.tracks.has(card.videoId)) return "track";
  return null;
};

/** What the links of a not-yet-hydrated card say, without page data. */
export interface CardLinks {
  videoIds: readonly string[];
  channelIds: readonly string[];
  texts: readonly string[];
}

/** The same decision from link ids and visible text, for cards hidden before paint. */
export const decideEarly = (rules: Rules, card: CardLinks): string | null => {
  const ids = [...card.videoIds, ...card.channelIds];
  if (ids.some((id) => rules.allowIds.has(id))) return null;
  if (card.texts.some((text) => rules.allowNames.has(text.trim().toLowerCase()))) return null;
  if (ids.some((id) => rules.blockIds.has(id))) return "user-block";
  if (card.texts.some((text) => rules.blockNames.has(text.trim().toLowerCase()))) return "user-block";
  if (rules.keywords.length && card.texts.some((text) => rules.keywords.some((keyword) => keyword.test(text)))) {
    return "keyword";
  }
  if (card.channelIds.some((id) => rules.channels.has(id))) return "channel";
  if (card.videoIds.some((id) => rules.tracks.has(id))) return "track";
  return null;
};

/** The channel that actually matched the community list or a learned artist. */
export const matchedChannel = (rules: Rules, channelIds: readonly string[]) =>
  channelIds.find((id) => rules.channels.has(id) || rules.session.has(id));
