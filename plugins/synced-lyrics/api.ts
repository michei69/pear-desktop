// JSON shapes the app's API server expects from the plugin's RPC methods.
// They match what pear-desktop's API answered with, so clients need no changes.

import type { CacheEntry } from "./translation/types.ts";
import type { LyricLine, LyricResult, LyricTranslation, ProviderId } from "./types.ts";

export interface ApiLyricLine {
  time: string;
  timeInMs: number;
  duration: number;
  text: string;
}

export interface ApiLyricTranslation {
  lyrics?: string;
  lines?: ApiLyricLine[];
  language?: string;
  provider?: string;
}

export interface ApiProviderLyrics {
  provider: ProviderId;
  state: "done";
  title: string;
  artists: string[];
  lyrics?: string;
  lines?: ApiLyricLine[];
  translation?: ApiLyricTranslation;
}

export interface ApiLyrics {
  videoId: string | null;
  activeProvider: ProviderId | null;
  providers: ApiProviderLyrics[];
}

export interface ApiCachedTranslation {
  language: string;
  provider: string;
  model: string;
  title: string;
  artists: string[];
  createdAt: number;
  lines: string[];
}

/** pear-desktop's line time: "mm:ss:cc". */
function apiTime(ms: number) {
  const centiseconds = Math.max(0, Math.floor(ms / 10));
  const minutes = Math.floor(centiseconds / 6000);
  const seconds = Math.floor(centiseconds / 100) % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(centiseconds % 100).padStart(2, "0")}`;
}

export function apiLines(lines: readonly LyricLine[]): ApiLyricLine[] {
  return lines.map((line) => ({
    time: apiTime(line.startMs),
    timeInMs: line.startMs,
    duration: Math.max(0, line.endMs - line.startMs),
    text: line.text,
  }));
}

function apiTranslation(translation: LyricTranslation | undefined): ApiLyricTranslation | undefined {
  if (!translation) return undefined;
  const lines = translation.lines?.length ? apiLines(translation.lines) : undefined;
  const lyrics = translation.plain?.trim() ? translation.plain : undefined;
  if (!lines && !lyrics) return undefined;
  return {
    ...(lyrics ? { lyrics } : {}),
    ...(lines ? { lines } : {}),
    ...(translation.language ? { language: translation.language } : {}),
    ...(translation.provider ? { provider: translation.provider } : {}),
  };
}

/** One provider's result, or nothing when it found no lyrics. */
export function apiProviderLyrics(provider: ProviderId, result: LyricResult | null): ApiProviderLyrics | undefined {
  if (!result) return undefined;
  const hasLines = result.lines?.some((line) => line.text.trim());
  if (!hasLines && !result.plain?.trim()) return undefined;

  const translation = apiTranslation(result.translation);
  return {
    provider,
    state: "done",
    title: result.title,
    artists: [...result.artists],
    ...(result.plain ? { lyrics: result.plain } : {}),
    ...(result.lines?.length ? { lines: apiLines(result.lines) } : {}),
    ...(translation ? { translation } : {}),
  };
}

export function apiCachedTranslation(entry: CacheEntry): ApiCachedTranslation {
  return {
    language: entry.targetLanguage,
    provider: entry.provider,
    model: entry.model,
    title: entry.title,
    artists: [...entry.artists],
    createdAt: entry.createdAt,
    lines: [...entry.lines],
  };
}
