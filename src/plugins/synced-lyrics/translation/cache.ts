import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

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
