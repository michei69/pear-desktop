import fs from 'node:fs';
import path from 'node:path';

import { app, session } from 'electron';

import { LoggerPrefix } from '@/utils';

const markerPath = () => path.join(app.getPath('userData'), 'cache-version');

/**
 * Code caches are keyed to the built renderer bundle. After an update the old
 * blobs are dead weight, so drop them once per app version. The marker is
 * written even when there is nothing to clear, so this is one stat per launch.
 */
export const clearStaleCodeCaches = async () => {
  const version = app.getVersion();

  try {
    if (fs.readFileSync(markerPath(), 'utf8') === version) return;
  } catch {
    // First launch after install: no stale caches to drop.
    fs.writeFileSync(markerPath(), version);
    return;
  }

  try {
    await session.defaultSession.clearCodeCaches({});
  } catch (error) {
    console.error(LoggerPrefix, 'Failed to clear stale code caches:', error);
  }

  fs.writeFileSync(markerPath(), version);
};
