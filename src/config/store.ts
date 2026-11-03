import { join } from 'node:path';

import { app } from 'electron';

import { channel } from '@/app-info';
import { migrationBaseVersion } from '@/providers/app-versions';

import { defaultConfig as defaults } from './defaults';
import { createMigrations, readStoredChannel } from './migrations';

import packageJson from '../../package.json' with { type: 'json' };

// HACK: electron-store is ESM, but rolldown has a bug that prevents importing it from CommonJS, so it has to be required here
/* oxlint-disable typescript/no-require-imports */
const Store = (
  require('electron-store') as {
    default: typeof import('electron-store').default;
  }
).default;
/* oxlint-enable typescript/no-require-imports */

export type IStore = InstanceType<
  typeof import('conf').default<Record<string, unknown>>
>;

/**
 * The channel the config file held before this store was created. Read here, not
 * in the migration: conf writes the defaults into the file first, so
 * `options.updateChannel` already reads back as `stable`. Main process only: the
 * preload bundles this module too, where `app` does not exist and reading the
 * file would kill it.
 */
const channelBeforeDefaults =
  process.type === 'browser'
    ? readStoredChannel(join(app.getPath('userData'), 'config.json'))
    : undefined;

const migrations = createMigrations({
  buildChannel: channel,
  channelBeforeDefaults,
});

/**
 * `conf` normalises this through `semver.clean` anyway; doing it here keeps the
 * marker spelled the same for `3.12.4-beta.1` and `3.12.4`, which is the point of
 * the split. `projectVersion` is a `conf` option electron-store hides from its
 * types, so it ships as an extra property.
 */
const projectVersion = {
  projectVersion: migrationBaseVersion(packageJson.version),
};

export const store = new Store({
  defaults: {
    ...defaults,
    // README: deepmerge fills in `plugin` defaults, so it need not be listed here
  },
  clearInvalidConfig: false,
  migrations,
  ...projectVersion,
} as ConstructorParameters<typeof Store<Record<string, unknown>>>[0]);
