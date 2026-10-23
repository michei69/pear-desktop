// The profiles' bundled lists, plus the user's own remote, inline and local lists
// in Ghostery's engine. The engine (engine.ts) caches the built filter engine
// next to these lists.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import balancedRules from "./lists/balanced.txt?raw";
import strictRules from "./lists/strict-addon.txt?raw";
import { BALANCED, LITE, STRICT, type Profile } from "./schema.ts";

export const SOURCES_URL = "https://raw.githubusercontent.com/organization/tb-list/refs/heads/main/tb.json";

/** tb.json as of this release: used until the first fetch, and when it fails. */
export const BUILTIN_SOURCES: readonly string[] = [
  "https://raw.githubusercontent.com/kbinani/adblock-\u0079\u006f\u0075\u0074\u0075\u0062\u0065-ads/master/signed.txt",
  "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters.txt",
  "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/quick-fixes.txt",
  "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/unbreak.txt",
  "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2020.txt",
  "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2021.txt",
  "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2022.txt",
  "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2023.txt",
  "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2024.txt",
  "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2025.txt",
  "https://secure.fanboy.co.nz/fanboy-annoyance_ubo.txt",
  "https://filters.adtidy.org/extension/ublock/filters/122_optimized.txt",
];

/** A filter list: fetched from `url`, or its bundled/local contents. */
export interface FilterSource {
  url: string;
  /** Absent for lists the engine fetches itself. */
  contents?: string;
}

/** The list URLs in a tb.json document (`{ "tb": [...] }`), or undefined if it isn't one. */
export function parseSources(document: unknown): string[] | undefined {
  const tb = (document as { tb?: unknown } | null)?.tb;
  if (!Array.isArray(tb)) return;
  const urls = tb.filter((url): url is string => typeof url === "string" && URL.canParse(url));
  return urls.length > 0 ? urls : undefined;
}

const UTM_PARAMETERS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_id",
  "utm_term",
  "utm_content",
  "utm_source_platform",
  "utm_creative_format",
  "utm_marketing_tactic",
];

/**
 * Ghostery doesn't support regex $removeparam filters, and needs a URL pattern
 * before a bare $removeparam: expand and prefix them like pear-desktop does.
 */
function normalizeBlockList(contents: string) {
  return contents
    .split("\n")
    .flatMap((line) => {
      const rule = line.trim();
      if (rule === "$removeparam=/^utm_/") return UTM_PARAMETERS.map((parameter) => `*$removeparam=${parameter}`);
      return rule.startsWith("$removeparam=") ? `*${rule}` : line;
    })
    .join("\n");
}

const bundled = (url: string, contents: string): FilterSource => ({ url, contents: normalizeBlockList(contents) });

/** The lists a profile starts from: Lite blocks in the player only (prune.ts). */
export const PROFILE_SOURCES: Record<Profile, readonly FilterSource[]> = {
  [LITE]: [],
  [BALANCED]: [bundled("builtin-blocklist://balanced", balancedRules)],
  [STRICT]: [bundled("builtin-blocklist://balanced", balancedRules), bundled("builtin-blocklist://strict-addon", strictRules)],
};

export interface ListOptions {
  profile: Profile;
  customEnabled: boolean;
  disableDefaultLists: boolean;
  additionalBlockLists: readonly string[];
  additionalBlockListRules: readonly string[];
}

/**
 * Which lists to load: the profile's bundled ones, and with custom lists on, the
 * curated ones (unless disabled), the user's URLs, local files and inline rules.
 * Later duplicate URLs are dropped (the first occurrence wins).
 */
export function chooseLists(curated: readonly string[], local: readonly FilterSource[], options: ListOptions): FilterSource[] {
  const own = options.customEnabled ? options.additionalBlockLists.map((url) => url.trim()).filter((url) => URL.canParse(url)) : [];
  const inline = options.customEnabled ? options.additionalBlockListRules.join("\n").trim() : "";
  const lists: FilterSource[] = [
    ...(options.customEnabled && !options.disableDefaultLists ? curated.map((url) => ({ url })) : []),
    ...own.map((url) => ({ url })),
    ...(options.customEnabled ? local : []),
    ...PROFILE_SOURCES[options.profile],
    ...(inline ? [{ url: "local-blocklist://inline-rules", contents: normalizeBlockList(inline) }] : []),
  ];

  const seen = new Set<string>();
  return lists.filter((list) => {
    if (seen.has(list.url)) return false;
    seen.add(list.url);
    return true;
  });
}

/** The local list files in `directory`, minus the disabled ones (readable files only). */
export async function loadLocalLists(directory: string, disabled: readonly string[]): Promise<FilterSource[]> {
  const off = new Set(disabled);
  try {
    await mkdir(directory, { recursive: true });
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && !off.has(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    const lists: FilterSource[] = [];
    for (const entry of entries) {
      try {
        const contents = await readFile(join(directory, entry.name), "utf8");
        lists.push({ url: `local-blocklist://file/${entry.name}`, contents: normalizeBlockList(contents) });
      } catch {
        // Unreadable: skip it rather than lose the other lists.
      }
    }
    return lists;
  } catch {
    return [];
  }
}

/** The curated list URLs: last known ones from the cache directory, else the built-in copy. */
export async function cachedSources(cacheDir: string | undefined): Promise<readonly string[]> {
  if (!cacheDir) return BUILTIN_SOURCES;
  try {
    return parseSources(JSON.parse(await readFile(join(cacheDir, "tb.json"), "utf8"))) ?? BUILTIN_SOURCES;
  } catch {
    return BUILTIN_SOURCES;
  }
}

/** Fetches the current curated list URLs (and remembers them); undefined when unreachable. */
export async function fetchSources(fetch: (url: string) => Promise<Response>, cacheDir: string | undefined) {
  try {
    const response = await fetch(SOURCES_URL);
    if (!response.ok) return;
    const sources = parseSources(await response.json());
    if (sources && cacheDir) {
      await mkdir(cacheDir, { recursive: true });
      await writeFile(join(cacheDir, "tb.json"), JSON.stringify({ tb: sources }));
    }
    return sources;
  } catch {
    return;
  }
}
