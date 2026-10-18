import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

import { TRANSLATION_STRATEGY_VERSION } from './version';

import type { CacheEntry } from './types';

const cacheDirName = 'synced-lyrics-translations';

const getCacheDir = () => path.join(app.getPath('userData'), cacheDirName);

/**
 * Keys are `${version}::${videoId}::...`, so the video id can lead the file
 * name: a per-video lookup reads only that video's files instead of parsing
 * every entry on disk. `@` cannot appear in a YouTube id.
 */
const fileNameFor = (key: string) =>
  `${key.split('::')[1] ?? ''}@${createHash('sha1').update(key).digest('hex')}.json`;

let dirPromise: Promise<string> | null = null;

const ensureDir = () => {
  if (!dirPromise) {
    const dir = getCacheDir();
    dirPromise = fs.mkdir(dir, { recursive: true }).then(
      () => dir,
      (error: unknown) => {
        // A failed mkdir must not poison every later call.
        dirPromise = null;
        throw error;
      },
    );
  }
  return dirPromise;
};

export const buildCacheKey = (parts: {
  videoId: string;
  targetLanguage: string;
  provider: string;
  model: string;
  sourceHash: string;
}) =>
  `${TRANSLATION_STRATEGY_VERSION}::${parts.videoId}::${parts.targetLanguage}::${parts.provider}::${parts.model}::${parts.sourceHash}`;

export const buildSourceHash = (lines: string[]) =>
  createHash('sha1').update(JSON.stringify(lines)).digest('hex');

export const readCache = async (key: string): Promise<CacheEntry | null> => {
  try {
    const dir = await ensureDir();
    const file = path.join(dir, fileNameFor(key));
    const content = await fs.readFile(file, 'utf-8');
    return JSON.parse(content) as CacheEntry;
  } catch {
    return null;
  }
};

export const writeCache = async (entry: CacheEntry): Promise<void> => {
  const dir = await ensureDir();
  const file = path.join(dir, fileNameFor(entry.key));
  await fs.writeFile(file, JSON.stringify(entry), 'utf-8');
};

/**
 * The entry a cache file holds, or null when it is unreadable or does not match
 * what `CacheEntry` promises. Everything `CacheEntry` declares is checked
 * against what is on disk, so the return type is a guarantee rather than a hope,
 * and one corrupt or half-written file never breaks a listing the API serves.
 */
const readEntryFile = async (file: string): Promise<CacheEntry | null> => {
  try {
    const entry = JSON.parse(
      await fs.readFile(file, 'utf-8'),
    ) as CacheEntry | null;
    if (
      typeof entry?.key === 'string' &&
      typeof entry.strategyVersion === 'string' &&
      typeof entry.targetLanguage === 'string' &&
      typeof entry.provider === 'string' &&
      typeof entry.model === 'string' &&
      typeof entry.sourceHash === 'string' &&
      typeof entry.title === 'string' &&
      typeof entry.createdAt === 'number' &&
      Array.isArray(entry.sourceLines) &&
      entry.sourceLines.every((line) => typeof line === 'string') &&
      Array.isArray(entry.artists) &&
      entry.artists.every((artist) => typeof artist === 'string') &&
      Array.isArray(entry.lines) &&
      entry.lines.every((line) => typeof line === 'string')
    ) {
      return entry;
    }
  } catch {
    // unreadable or corrupt — skip
  }
  return null;
};

/**
 * Every readable entry on disk, newest first is not guaranteed — callers filter.
 * Corrupt, half-written or shape-shifted files are skipped.
 */
export const listCache = async (): Promise<CacheEntry[]> => {
  const dir = getCacheDir();
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    // dir may not exist yet — nothing is cached
    return [];
  }

  const entries = await Promise.all(
    names
      .filter((name) => name.endsWith('.json'))
      .map((name) => readEntryFile(path.join(dir, name))),
  );
  return entries.filter((entry): entry is CacheEntry => entry !== null);
};

/**
 * Cached translations for one video. The video id leads the file name, so only
 * that video's files are read and parsed — a lookup does not touch the rest of
 * the cache.
 */
export const cacheEntriesForVideo = async (
  videoId: string,
): Promise<CacheEntry[]> => {
  const dir = getCacheDir();
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }

  const prefix = `${videoId}@`;
  const prefixKey = `${TRANSLATION_STRATEGY_VERSION}::${videoId}::`;
  const entries = await Promise.all(
    names
      .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
      .map((name) => readEntryFile(path.join(dir, name))),
  );
  return entries.filter(
    (entry): entry is CacheEntry =>
      entry !== null && entry.key.startsWith(prefixKey),
  );
};

export const clearCache = async (): Promise<number> => {
  const dir = getCacheDir();
  let count = 0;
  try {
    const entries = await fs.readdir(dir);
    for (const name of entries) {
      if (name.endsWith('.json')) {
        await fs.unlink(path.join(dir, name)).catch(() => {});
        count++;
      }
    }
  } catch {
    // dir may not exist yet — treat as 0
  }
  return count;
};
