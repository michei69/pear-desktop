// On-disk translation cache. Keys are `${version}::${videoId}::…` so a video's
// files can be listed without reading every entry on disk.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { CacheEntry } from "./types.ts";

export const TRANSLATION_STRATEGY_VERSION = "whole-song-v2";

const DIR_NAME = "synced-lyrics-translations";

/** `@` cannot appear in a YTM id, so the prefix lookup is unambiguous. */
const fileNameFor = (key: string) => `${key.split("::")[1] ?? ""}@${createHash("sha1").update(key).digest("hex")}.json`;

export function buildCacheKey(parts: { videoId: string; targetLanguage: string; provider: string; model: string; sourceHash: string }) {
  return `${TRANSLATION_STRATEGY_VERSION}::${parts.videoId}::${parts.targetLanguage}::${parts.provider}::${parts.model}::${parts.sourceHash}`;
}

export function buildSourceHash(lines: readonly string[]) {
  return createHash("sha1").update(JSON.stringify(lines)).digest("hex");
}

/** True when a parsed file has everything a `CacheEntry` promises. */
function isCacheEntry(value: unknown): value is CacheEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.key === "string" &&
    typeof entry.strategyVersion === "string" &&
    typeof entry.targetLanguage === "string" &&
    typeof entry.provider === "string" &&
    typeof entry.model === "string" &&
    typeof entry.sourceHash === "string" &&
    typeof entry.title === "string" &&
    typeof entry.createdAt === "number" &&
    Array.isArray(entry.sourceLines) &&
    entry.sourceLines.every((line) => typeof line === "string") &&
    Array.isArray(entry.artists) &&
    entry.artists.every((artist) => typeof artist === "string") &&
    Array.isArray(entry.lines) &&
    entry.lines.every((line) => typeof line === "string")
  );
}

export class TranslationCache {
  readonly #dir: string;
  #ready: Promise<void> | undefined;

  constructor(userData: string) {
    this.#dir = join(userData, DIR_NAME);
  }

  #ensureDir() {
    this.#ready ??= fs.mkdir(this.#dir, { recursive: true }).then(
      () => undefined,
      (error: unknown) => {
        // A failed mkdir must not poison every later call.
        this.#ready = undefined;
        throw error;
      },
    );
    return this.#ready;
  }

  async read(key: string): Promise<CacheEntry | null> {
    try {
      await this.#ensureDir();
      const content = await fs.readFile(join(this.#dir, fileNameFor(key)), "utf-8");
      const entry = JSON.parse(content) as unknown;
      return isCacheEntry(entry) ? entry : null;
    } catch {
      return null;
    }
  }

  async write(entry: CacheEntry): Promise<void> {
    await this.#ensureDir();
    await fs.writeFile(join(this.#dir, fileNameFor(entry.key)), JSON.stringify(entry), "utf-8");
  }

  async #readEntryFile(name: string): Promise<CacheEntry | null> {
    try {
      const entry = JSON.parse(await fs.readFile(join(this.#dir, name), "utf-8")) as unknown;
      return isCacheEntry(entry) ? entry : null;
    } catch {
      // unreadable, half-written or shape-shifted: skip
      return null;
    }
  }

  /** Every readable entry, without order. */
  async list(): Promise<CacheEntry[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.#dir);
    } catch {
      return [];
    }
    const entries = await Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => this.#readEntryFile(name)));
    return entries.filter((entry): entry is CacheEntry => entry !== null);
  }

  /** The cached translations of one video under the current strategy version. */
  async forVideo(videoId: string): Promise<CacheEntry[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.#dir);
    } catch {
      return [];
    }
    const prefix = `${videoId}@`;
    const prefixKey = `${TRANSLATION_STRATEGY_VERSION}::${videoId}::`;
    const entries = await Promise.all(
      names.filter((name) => name.startsWith(prefix) && name.endsWith(".json")).map((name) => this.#readEntryFile(name)),
    );
    return entries.filter((entry): entry is CacheEntry => entry !== null && entry.key.startsWith(prefixKey));
  }

  /** Deletes every cached translation; returns how many files were removed. */
  async clear(): Promise<number> {
    let names: string[];
    try {
      names = await fs.readdir(this.#dir);
    } catch {
      return 0;
    }
    let count = 0;
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      await fs.unlink(join(this.#dir, name)).catch(() => {});
      count += 1;
    }
    return count;
  }
}
