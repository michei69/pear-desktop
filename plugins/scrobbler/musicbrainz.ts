// Opt-in MusicBrainz correction: asks the recording database for the song the
// title and artist most likely name, and corrects both. Requests are cached by
// title and artist, serialized (MusicBrainz asks for at most one per second)
// and bounded by a timeout, so a slow or failing server never holds a
// submission up for long.

import { sleep } from "@pear/sdk/util";
import type { Fetch } from "./services.ts";

export interface Correction {
  title: string;
  artist: string;
}

interface Recording {
  id: string;
  title: string;
  score: number;
  "artist-credit"?: { name?: string }[];
}

interface ResponseBody {
  recordings?: Recording[];
}

/** A result scoring below this is treated as "not this song" (pear-desktop's cut-off). */
const MIN_SCORE = 85;
const MAX_ATTEMPTS = 3;
const MIN_INTERVAL_MS = 1050;
const REQUEST_TIMEOUT_MS = 5000;
const RETRY_DELAY_MS = 2000;
const SERVICE_UNAVAILABLE_DELAY_MS = 5000;
const CACHE_LIMIT = 200;

/** Resolved corrections, including misses (null); keyed by artist and title. */
const cache = new Map<string, Correction | null>();

// One request at a time, with MusicBrainz's requested gap between them.
let queueTail: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(task, task);
  queueTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function request(url: string, email: string, fetch: Fetch): Promise<Response | null> {
  return enqueue(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    try {
      return await fetch(url, {
        headers: {
          // MusicBrainz asks for a descriptive User-Agent with contact info.
          "User-Agent": `pear-desktop ( ${email} )`,
          Accept: "application/json",
          From: email,
        },
        // A hung request must not hold the queue, and with it every later correction.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return null;
    }
  });
}

async function fetchWithRetry(url: string, email: string, fetch: Fetch, isCancelled: () => boolean) {
  let response: Response | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (isCancelled()) return null;
    response = await request(url, email, fetch);
    if (isCancelled()) return null;
    // A 4xx means we asked wrong and will again; only server failures are retried.
    const isSuccess = response !== null && response.status < 500;
    if (isSuccess) break;
    await sleep(response?.status === 503 ? SERVICE_UNAVAILABLE_DELAY_MS : RETRY_DELAY_MS);
  }
  return response;
}

/** "Artist - Title" as many YTM videos are named. */
export function parseArtistTitle(title: string): { artist: string; title: string } | null {
  const parts = title.split(/\s+[-–—]\s+/);
  if (parts.length !== 2) return null;
  const artist = parts[0]!.trim();
  const song = parts[1]!.trim();
  return artist && song ? { artist, title: song } : null;
}

const REMIX = /remix|mix|mashup|edit|bootleg|cover|flip|vip|slowed|reverb|sped\s*up/i;

/**
 * Whether a free-form MusicBrainz hit is a different song: a remix/cover where
 * the original was not, or a title sharing no first word with ours.
 */
export function isDifferentVersion(originalTitle: string, parsedTitle: string | null, returnedTitle: string) {
  const retClean = returnedTitle
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .trim();
  const origClean = (parsedTitle || originalTitle)
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .trim();
  const [retWord, origWord] = [retClean.split(/\s+/)[0], origClean.split(/\s+/)[0]];
  return (
    (!!retWord && !!origWord && !origClean.includes(retWord) && !retClean.includes(origWord)) ||
    (REMIX.test(origClean) && !REMIX.test(retClean))
  );
}

const isBad = (body: ResponseBody | null) => !body?.recordings?.length || body.recordings[0]!.score < MIN_SCORE;

/** Asks MusicBrainz; `isCancelled` stops work for a play the user has left. */
async function lookup(title: string, artist: string, email: string, fetch: Fetch, isCancelled: () => boolean): Promise<Correction | null> {
  const parsed = parseArtistTitle(title);
  const query = async (recording: string, artistName?: string): Promise<ResponseBody | null> => {
    if (isCancelled()) return null;
    const escape = (value: string) => value.replace(/[\\"]/g, "\\$&");
    const search = artistName ? `recording:"${escape(recording)}" AND artist:"${escape(artistName)}"` : escape(recording);
    const response = await fetchWithRetry(
      `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(search)}&fmt=json&limit=1`,
      email,
      fetch,
      isCancelled,
    );
    if (isCancelled() || !response?.ok) return null;
    try {
      return (await response.json()) as ResponseBody;
    } catch {
      return null;
    }
  };

  let body = await query(title, artist);
  if (isCancelled()) return null;

  // Many videos are named "Artist - Title"; search that way next.
  if (isBad(body) && parsed) {
    body = await query(parsed.title, parsed.artist);
    if (isCancelled()) return null;
  }

  // Last try: the title alone, accepted only when the returned artist is named
  // in our title and the result is not a different version of the song.
  if (isBad(body)) {
    const fallback = await query(title);
    if (isCancelled()) return null;
    if (!isBad(fallback)) {
      const top = fallback!.recordings![0]!;
      const returnedArtist = (top["artist-credit"]?.[0]?.name ?? "").toLowerCase();
      if (returnedArtist && title.toLowerCase().includes(returnedArtist) && !isDifferentVersion(title, parsed?.title ?? null, top.title)) {
        body = fallback;
      }
    }
  }

  if (!isBad(body)) {
    return {
      title: body!.recordings![0]!.title,
      artist: body!.recordings![0]!["artist-credit"]?.[0]?.name || artist,
    };
  }

  // MusicBrainz has nothing usable: the "Artist - Title" parse is still better.
  return parsed;
}

export async function fetchMusicBrainzCorrection(
  title: string,
  artist: string,
  email: string,
  fetch: Fetch,
  isCancelled: () => boolean = () => false,
): Promise<Correction | null> {
  if (isCancelled()) return null;

  const key = JSON.stringify([artist, title]);
  if (cache.has(key)) return cache.get(key)!;
  if (cache.size >= CACHE_LIMIT) cache.clear();

  let correction: Correction | null;
  try {
    correction = await lookup(title, artist, email, fetch, isCancelled);
  } catch (error) {
    console.error("Failed to fetch from MusicBrainz:", error);
    correction = parseArtistTitle(title);
  }

  // The play changed while we waited: this answer is for a stale scrobble.
  if (isCancelled()) return null;
  cache.set(key, correction);
  return correction;
}
