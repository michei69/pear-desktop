// Lyrics for the files the built-in engine writes, from LRCLib (synced-lyrics'
// main provider), asked directly (host only; the matching is pure and unit-tested).

const BASE = "https://lrclib.net/api";
/** A recording this many seconds longer or shorter is another one. */
const MAX_DURATION_DIFF = 15;
const HTTP_NOT_FOUND = 404;

export interface LyricsQuery {
  /** The video, when the built-in engine has one (lets synced-lyrics use its settings). */
  videoId?: string | undefined;
  title: string;
  artist: string;
  album?: string | undefined;
  durationSeconds: number;
}

export interface Lyrics {
  /** Unsynced text, for the tags. */
  plain: string;
  /** LRC, for an .lrc file. */
  synced?: string | undefined;
}

export interface LrclibEntry {
  trackName: string;
  artistName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

type Fetch = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;

const simple = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[([].*?[)\]]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** The entry for this recording: the right title and artist, the closest duration, synced lyrics on ties. */
export function pickLyrics(entries: readonly LrclibEntry[], query: LyricsQuery): LrclibEntry | undefined {
  const title = simple(query.title);
  const artist = simple(query.artist);
  const matches = (a: string, b: string) => a.includes(b) || b.includes(a);
  const score = (entry: LrclibEntry) => Math.round(Math.abs(entry.duration - query.durationSeconds)) * 2 - (entry.syncedLyrics ? 1 : 0);
  return entries
    .filter(
      (entry) =>
        Math.abs(entry.duration - query.durationSeconds) <= MAX_DURATION_DIFF &&
        matches(simple(entry.trackName), title) &&
        matches(simple(entry.artistName), artist),
    )
    .sort((a, b) => score(a) - score(b))[0];
}

/** LRC without its timestamps, for when an entry only has synced lyrics. */
export const unsynced = (lrc: string) =>
  lrc
    .split(/\r?\n/)
    .map((line) => line.replace(/^(\[[^\]]*\])+/, "").trim())
    .filter((line, index, lines) => line !== "" || (index > 0 && lines[index - 1] !== ""))
    .join("\n")
    .trim();

/** The subset of the synced-lyrics API's provider payload the downloader reads. */
export interface SyncedLyricsResponse {
  activeProvider?: string | null;
  providers?: {
    provider?: string;
    lyrics?: string;
    lines?: { timeInMs?: number; text?: string }[];
  }[];
}

const lrcTime = (ms: number) => {
  const centiseconds = Math.max(0, Math.round(ms / 10));
  const minutes = Math.floor(centiseconds / 6000);
  const seconds = Math.floor(centiseconds / 100) % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds % 100).padStart(2, "0")}`;
};

/** Converts the API's provider list into the downloader's plain/LRC pair, preferring the selected provider. */
export function lyricsFromSyncedLyrics(value: unknown): Lyrics | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const response = value as SyncedLyricsResponse;
  const providers = Array.isArray(response.providers) ? response.providers : [];
  const entry = providers.find((candidate) => candidate.provider === response.activeProvider) ?? providers[0];
  if (!entry) return undefined;
  const lines = (entry.lines ?? []).filter(
    (line): line is { timeInMs: number; text: string } =>
      typeof line.timeInMs === "number" && typeof line.text === "string" && line.text.trim() !== "",
  );
  const synced = lines.length ? lines.map((line) => `[${lrcTime(line.timeInMs)}]${line.text}`).join("\n") : undefined;
  const plain = entry.lyrics?.trim() || (synced ? unsynced(synced) : "");
  return plain ? { plain, ...(synced ? { synced } : {}) } : undefined;
}

/** The song's lyrics, or undefined when LRCLib has none (or only knows it's instrumental). */
export async function findLyrics(query: LyricsQuery, fetch: Fetch, signal: AbortSignal): Promise<Lyrics | undefined> {
  const headers = { "Lrclib-Client": "pear-desktop downloader" };
  const get = async <T>(path: string, params: Record<string, string>) => {
    const response = await fetch(`${BASE}/${path}?${new URLSearchParams(params)}`, { signal, headers });
    if (response.status === HTTP_NOT_FOUND) return undefined;
    if (!response.ok) throw new Error(`LRCLib answered HTTP ${response.status}`);
    return (await response.json()) as T;
  };
  const exact: Record<string, string> = {
    track_name: query.title,
    artist_name: query.artist,
    duration: String(Math.round(query.durationSeconds)),
  };
  if (query.album) exact.album_name = query.album;
  let entry = await get<LrclibEntry>("get", exact);
  if (!entry) entry = pickLyrics((await get<LrclibEntry[]>("search", { track_name: query.title, artist_name: query.artist })) ?? [], query);
  if (!entry || entry.instrumental) return undefined;
  const plain = entry.plainLyrics?.trim() || (entry.syncedLyrics ? unsynced(entry.syncedLyrics) : "");
  if (!plain) return undefined;
  return { plain, synced: entry.syncedLyrics ?? undefined };
}
