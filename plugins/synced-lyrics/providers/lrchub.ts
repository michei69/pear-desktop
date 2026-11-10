// LRCHub: one POSTed lookup that resolves the track itself (video id first, then
// title and artist). Its word-synced fields use enhanced-LRC tags, which the
// line parser keeps as karaoke words.

import { parseLrc } from "../lrc.ts";
import type { LyricResult, SearchQuery } from "../types.ts";
import type { Fetch } from "./http.ts";

const BASE = "https://lrchub.coreone.work";
const ATTEMPTS = 3;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

interface LrchubRecord {
  found?: unknown;
  track?: unknown;
  artist?: unknown;
  artist_name?: unknown;
  synced_lyrics?: unknown;
  lyrics?: unknown;
  dynamic_lrc?: unknown;
  plain_lyrics?: unknown;
}

const textOf = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** The LRC LRCHub has for a record, best first; word-synced tags are kept. */
export const pickLrchubLrc = (record: LrchubRecord): string =>
  textOf(record.synced_lyrics) || textOf(record.lyrics) || textOf(record.dynamic_lrc);

const splitArtists = (artists: string) =>
  artists
    .split(/[&,]|\s+(?:feat\.?|ft\.?)\s+/i)
    .map((artist) => artist.trim())
    .filter(Boolean);

/**
 * LRCHub answers a flat 503 `SERVER_BUSY` when overloaded, asking the client to
 * wait and retry. Two short retries keep the provider usable without surfacing
 * the load as a lyrics error.
 */
async function requestLyrics(fetch: Fetch, body: object): Promise<[number, string]> {
  const url = `${BASE}/api/lyrics`;
  const init: RequestInit = {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  };

  let response: [number, string] = [0, ""];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const answer = await fetch(url, init);
      response = [answer.status, await answer.text()];
    } catch (error) {
      if (attempt === ATTEMPTS) throw error;
      response = [0, ""];
    }
    if (!RETRYABLE_STATUSES.has(response[0]) || attempt === ATTEMPTS) break;
    await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
  }
  return response;
}

export async function lrchub(query: SearchQuery, fetch: Fetch): Promise<LyricResult | null> {
  const [status, text] = await requestLyrics(fetch, { track: query.title, artist: query.artist, video_id: query.videoId });

  if (status === 404) return null;
  // Overloaded, not broken: no lyrics this time, the next song may work.
  if (RETRYABLE_STATUSES.has(status)) return null;
  if (status < 200 || status >= 300) throw new Error(`${new URL(BASE).host} responded ${status}`);

  let parsed: (LrchubRecord & { record?: LrchubRecord }) | null;
  try {
    parsed = JSON.parse(text) as (LrchubRecord & { record?: LrchubRecord }) | null;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const record = parsed.record && typeof parsed.record === "object" ? parsed.record : parsed;
  if (record.found === false) return null;

  const lrc = pickLrchubLrc(record);
  const plain = textOf(record.plain_lyrics);
  const lines = lrc ? parseLrc(lrc, query.durationSeconds * 1000) : [];
  if (lines.length === 0 && !plain) return null;

  const artists = splitArtists(textOf(record.artist) || textOf(record.artist_name) || query.artist);

  const result: LyricResult = {
    title: textOf(record.track) || query.title,
    artists: artists.length > 0 ? artists : splitArtists(query.artist),
  };
  if (lines.length > 0) result.lines = lines;
  if (plain) result.plain = plain;
  return result;
}
