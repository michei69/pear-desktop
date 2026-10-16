import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

import { TRANSLATION_STRATEGY_VERSION } from './version';

import type { CacheEntry } from './types';

const cacheDirName = 'synced-lyrics-translations';

const getCacheDir = () => path.join(app.getPath('userData'), cacheDirName);

const fileNameFor = (key: string) =>
  createHash('sha1').update(key).digest('hex') + '.json';

const ensureDir = async () => {
  const dir = getCacheDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
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
  await fs.writeFile(file, JSON.stringify(entry, null, 2), 'utf-8');
};

/**
 * Every readable entry on disk, newest first is not guaranteed — callers filter.
 * Corrupt, half-written or shape-shifted files are skipped: one bad file must
 * not break a listing the API serves, nor make it serve something the response
 * schema does not describe.
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

  const entries: CacheEntry[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const content = await fs.readFile(path.join(dir, name), 'utf-8');
      const entry = JSON.parse(content) as CacheEntry | null;
      // Everything `CacheEntry` declares, checked against what is on disk, so
      // the return type is a guarantee rather than a hope.
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
        entries.push(entry);
      }
    } catch {
      // unreadable or corrupt — skip
    }
  }
  return entries;
};

/**
 * Cached translations for one video. `CacheEntry` carries no video id, but the
 * key is `${version}::${videoId}::...`, so a prefix match is exact.
 */
export const cacheEntriesForVideo = async (
  videoId: string,
): Promise<CacheEntry[]> => {
  const prefix = `${TRANSLATION_STRATEGY_VERSION}::${videoId}::`;
  return (await listCache()).filter((entry) => entry.key.startsWith(prefix));
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
