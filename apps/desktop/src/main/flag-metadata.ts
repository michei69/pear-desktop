// Descriptions, families and restart requirements for Music's feature
// flags: the published flags.json, cached so a launch without a network still
// has them. The settings UI's Flags section shows these next to each flag.

import fs from "node:fs";
import path from "node:path";
import { app, net } from "electron";
import type { FlagMetadata, FlagMetadataMap } from "@pear/sdk/protocol";

/** The published metadata, maintained by the fork's datamining repo. */
const FLAG_METADATA_URL = "https://raw.githubusercontent.com/michei69/ytm-datamining/refs/heads/main/flags.json";

/** A slow GitHub must not hold the settings UI open any longer than this. */
const DOWNLOAD_TIMEOUT_MS = 10_000;

let metadata: FlagMetadataMap = {};
let loading: Promise<void> | undefined;

/** The last download, so a launch without a network still has descriptions. */
const cachePath = () => path.join(app.getPath("userData"), "flags.json");

/**
 * The published file is remote input, so only entries shaped the way the
 * settings UI reads them are kept; a stray entry would render as a blank row.
 */
export function sanitizeFlagMetadata(raw: unknown): FlagMetadataMap {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};

  const out: FlagMetadataMap = {};
  for (const [name, entry] of Object.entries(raw)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const fields = entry as Record<string, unknown>;
    const metadata: FlagMetadata = {
      requires_restart: fields.requires_restart === true,
      family: typeof fields.family === "string" ? fields.family : "",
    };
    if (typeof fields.description === "string") metadata.description = fields.description;
    out[name] = metadata;
  }
  return out;
}

const readCache = (): FlagMetadataMap => {
  try {
    return sanitizeFlagMetadata(JSON.parse(fs.readFileSync(cachePath(), "utf8")));
  } catch {
    // Never downloaded, or unreadable: the flags just have no metadata.
    return {};
  }
};

const download = async () => {
  try {
    const response = await net.fetch(FLAG_METADATA_URL, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    metadata = sanitizeFlagMetadata(await response.json());
  } catch (error) {
    // Offline, or GitHub is unreachable: the cached copy is as good as it gets.
    console.error("[pear] failed to download feature flag metadata", error);
    metadata = readCache();
    return;
  }

  // Separate from the download: an unwritable cache must not discard the
  // metadata that just arrived.
  try {
    fs.writeFileSync(cachePath(), JSON.stringify(metadata));
  } catch (error) {
    console.error("[pear] failed to cache feature flag metadata", error);
  }
};

/** Started once at launch; the settings UI awaits the very same download. */
export const loadFlagMetadata = (): Promise<void> => (loading ??= download());

export const flagMetadata = async (): Promise<FlagMetadataMap> => {
  // Also covers the section opening before startup got to it.
  await loadFlagMetadata();
  return metadata;
};
