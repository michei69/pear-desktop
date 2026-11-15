// Per-song custom search queries, persisted in userData so they survive a
// restart and are shared by the page picker and the API's RPC methods.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CustomQuery } from "./types.ts";

function isCustomQuery(value: unknown): value is CustomQuery {
  if (!value || typeof value !== "object") return false;
  const query = "query" in value ? value.query : undefined;
  const artist = "artist" in value ? value.artist : undefined;
  return typeof query === "string" && query.trim().length > 0 && (artist === undefined || typeof artist === "string");
}

export class CustomQueryStore {
  readonly #path: string;
  #entries: Promise<Record<string, CustomQuery>> | undefined;
  #writes: Promise<void> = Promise.resolve();

  constructor(userData: string) {
    this.#path = join(userData, "synced-lyrics", "custom-queries.json");
  }

  #load() {
    this.#entries ??= readFile(this.#path, "utf-8")
      .then((text): Record<string, CustomQuery> => {
        const parsed = JSON.parse(text) as unknown;
        if (!parsed || typeof parsed !== "object") return {};
        const entries: Record<string, CustomQuery> = {};
        for (const [videoId, value] of Object.entries(parsed)) {
          if (isCustomQuery(value))
            entries[videoId] = { query: value.query.trim(), ...(value.artist?.trim() ? { artist: value.artist.trim() } : {}) };
        }
        return entries;
      })
      .catch((): Record<string, CustomQuery> => ({}));
    return this.#entries;
  }

  async get(videoId: string) {
    return (await this.#load())[videoId] ?? null;
  }

  async set(videoId: string, query: CustomQuery) {
    const text = query.query.trim();
    if (!text) throw new Error("custom search needs a query");
    const entries = await this.#load();
    entries[videoId] = { query: text, ...(query.artist?.trim() ? { artist: query.artist.trim() } : {}) };
    await this.#save();
    return entries[videoId]!;
  }

  async remove(videoId: string) {
    const entries = await this.#load();
    if (!(videoId in entries)) return;
    delete entries[videoId];
    await this.#save();
  }

  #save() {
    const snapshot = this.#load().then((entries) => JSON.stringify(entries));
    this.#writes = this.#writes
      .catch(() => {})
      .then(async () => {
        const text = await snapshot;
        await mkdir(dirname(this.#path), { recursive: true });
        const temporary = `${this.#path}.part`;
        await writeFile(temporary, text, "utf-8");
        await rename(temporary, this.#path);
      })
      .catch((error: unknown) => {
        console.warn("[pear:synced-lyrics] could not save custom queries", error);
      });
    return this.#writes;
  }
}
