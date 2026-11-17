// BetterLyrics, after Metrolist's BetterLyricsProvider: one JSON call for
// Apple-style TTML, retried without the album when an album-specific lookup
// found nothing.

import type { LyricResult, SearchQuery } from "../types.ts";
import { request, type Fetch } from "./http.ts";
import { textOf } from "./shared.ts";
import { ttmlToResult } from "./ttml-result.ts";

const GET_LYRICS = "https://lyrics-api.boidu.dev/getLyrics";

/** The answer's `ttml` field, when it holds a usable string. */
export function parseTtmlResponse(value: unknown): string | null {
  const ttml = textOf((value as { ttml?: unknown } | null)?.ttml);
  return ttml || null;
}

async function fetchTtml(fetch: Fetch, query: SearchQuery, album: string | undefined): Promise<string | null> {
  const params: Record<string, string> = { s: query.title, a: query.artist };
  if (query.durationSeconds > 0) params.d = String(Math.round(query.durationSeconds));
  if (album) params.al = album;
  try {
    const response = await request(fetch, `${GET_LYRICS}?${new URLSearchParams(params)}`, {
      headers: { Accept: "application/json" },
    });
    return parseTtmlResponse(await response.json());
  } catch {
    return null;
  }
}

export async function betterlyrics(query: SearchQuery, fetch: Fetch): Promise<LyricResult | null> {
  const album = query.album?.trim() || undefined;
  for (const attempt of album ? [album, undefined] : [undefined]) {
    const ttml = await fetchTtml(fetch, query, attempt);
    if (!ttml) continue;
    const result = ttmlToResult(ttml, query.title, query.artist, "BetterLyrics");
    if (result) return result;
  }
  return null;
}
