import fs from 'node:fs';
import path from 'node:path';

import { app, net } from 'electron';

import {
  sanitizeFlagMetadata,
  type FlagMetadataMap,
} from '@/types/flag-metadata';

/** Descriptions, families and restart requirements for YouTube Music's flags. */
const FLAG_METADATA_URL =
  'https://raw.githubusercontent.com/michei69/pear-desktop/refs/heads/master/flags.json';

/** A slow GitHub must not hold the settings UI open any longer than this. */
const DOWNLOAD_TIMEOUT_MS = 10_000;

let metadata: FlagMetadataMap = {};
let loading: Promise<void> | undefined;

/** The last download, so a launch without a network still has descriptions. */
const cachePath = () => path.join(app.getPath('userData'), 'flags.json');

const readCache = (): FlagMetadataMap => {
  try {
    return sanitizeFlagMetadata(
      JSON.parse(fs.readFileSync(cachePath(), 'utf8')),
    );
  } catch {
    // Never downloaded, or unreadable: the flags just have no metadata.
    return {};
  }
};

const download = async () => {
  try {
    const response = await net.fetch(FLAG_METADATA_URL, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    metadata = sanitizeFlagMetadata(await response.json());
  } catch (error) {
    // Offline, or GitHub is unreachable: the cached copy is as good as it gets.
    console.error('Failed to download feature flag metadata', error);
    metadata = readCache();
    return;
  }

  // Kept apart from the download: an unwritable cache is no reason to throw
  // away the metadata that just arrived.
  try {
    fs.writeFileSync(cachePath(), JSON.stringify(metadata));
  } catch (error) {
    console.error('Failed to cache feature flag metadata', error);
  }
};

/** Started once at launch; the settings UI awaits the very same download. */
export const loadFlagMetadata = (): Promise<void> => (loading ??= download());

export const flagMetadata = async (): Promise<FlagMetadataMap> => {
  // Also covers the section opening before startup got to it.
  await loadFlagMetadata();
  return metadata;
};
