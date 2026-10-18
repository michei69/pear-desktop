/**
 * The pieces of the store's migrations that the tests can drive directly: pure
 * and electron-free, unlike `store.ts`, which builds a real store the moment it
 * is imported. `store.ts` wires these to the build environment.
 */
import { readFileSync } from 'node:fs';

import {
  defaultUpdateChannel,
  type Channel,
  type UpdateChannel,
} from '../app-info';

import type { IStore } from './store';

/**
 * The channel the config file held before the store wrote its defaults. `conf`
 * writes the defaults into the file before migrations run, so a migration
 * cannot read the choice back from the store itself.
 */
export function readStoredChannel(path: string): UpdateChannel | undefined {
  try {
    const stored = JSON.parse(readFileSync(path, 'utf8')) as {
      options?: { updateChannel?: unknown };
    };
    const channel = stored.options?.updateChannel;
    return channel === 'stable' || channel === 'beta' ? channel : undefined;
  } catch {
    // No file yet, or unreadable: nothing was chosen.
    return undefined;
  }
}

/**
 * The '>=3.12.4' migration: a beta build should follow the beta channel from
 * the start, without overriding a channel the user already picked.
 */
export const seedUpdateChannel =
  (buildChannel: Channel, before: UpdateChannel | undefined) =>
  (store: IStore) => {
    if (before === undefined) {
      store.set('options.updateChannel', defaultUpdateChannel(buildChannel));
    }
  };
