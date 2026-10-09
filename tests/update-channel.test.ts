/**
 * Update channels (stable/beta), auto-updates, beta-aware migrations and the
 * dev "behind master" notice: an item-by-item verification of the shipped code.
 *
 * Everything here is offline and electron-free: the parts that need a running
 * app (menus, dialogs, the real feed) are checked against the source text and,
 * where possible, against the real third-party code the app delegates to.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import Conf from 'conf';
import { AppUpdater } from 'electron-updater';
import { GitHubProvider } from 'electron-updater/out/providers/GitHubProvider.js';
import { createInstance } from 'i18next';
import semver from 'semver';

import { defaultUpdateChannel, updatesSupported } from '../src/app-info';
import { defaultConfig } from '../src/config/defaults';
import { migrationBaseVersion } from '../src/providers/app-versions';

import type { UpdateChannel } from '../src/app-info';

const repoRoot = join(import.meta.dirname, '..');
const read = (relative: string) => readFileSync(join(repoRoot, relative), 'utf8');

const src = {
  updates: read('src/providers/app-updates.ts'),
  versions: read('src/providers/app-versions.ts'),
  menu: read('src/menu.ts'),
  settings: read('src/plugins/settings-ui/schema/app-settings.ts'),
  store: read('src/config/store.ts'),
};

/** `t('some.key')` string literals in a source file. */
const i18nKeysIn = (file: string) =>
  [...read(file).matchAll(/\bt\(\s*'([^']+)'/g)].map((match) => match[1]);

/** `menuLabel('path')` is `t('main.menu.options.submenu.' + path)`. */
const menuLabelKeysIn = (file: string) =>
  [...read(file).matchAll(/menuLabel\(\s*'([^']+)'/g)].map(
    (match) => `main.menu.options.submenu.${match[1]}`,
  );

const english = JSON.parse(read('src/i18n/resources/en.json'));

/** The same resource shape the bundler's `virtual:i18n` hands to i18next. */
const i18n = async () => {
  const instance = createInstance();
  await instance.init({
    resources: { en: { translation: english } },
    lng: 'en',
    fallbackLng: 'en',
    showSupportNotice: false,
  });
  return instance;
};

const slice = (file: string, start: string) => {
  const from = file.indexOf(start);
  expect(from, `source anchor "${start}" not found`).toBeGreaterThanOrEqual(0);
  return file.slice(from);
};

// --------------------------------------------------------------- item 1 ---
// Stable vs beta feed selection: both flags have to flip together, and the
// flags have to mean what electron-updater says they mean.

test('item 1: applyChannel flips allowPrerelease and the channel together', () => {
  const body = slice(src.updates, 'const applyChannel =');
  const end = body.indexOf('\n};');
  const applyChannel = body.slice(0, end);

  // beta -> allowPrerelease true + beta feed; anything else -> false + latest.
  expect(applyChannel).toContain(
    "autoUpdater.allowPrerelease = updateChannel === 'beta';",
  );
  expect(applyChannel).toContain(
    'autoUpdater.channel = feedChannel(updateChannel);',
  );
  expect(applyChannel).toContain('channel: feedChannel(updateChannel),');
  expect(src.updates).toMatch(
    /const feedChannel = \(updateChannel: UpdateChannel\) =>\s*\n\s*updateChannel === 'beta' \? 'beta' : 'latest';/,
  );
});

/** A GitHub release feed with the beta tag first, as a rolling beta would be. */
const ATOM_FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Pear Desktop 3.12.4-beta.1</title>
    <link rel="alternate" type="text/html" href="https://github.com/michei69/pear-desktop/releases/tag/v3.12.4-beta.1"/>
    <content type="html">beta notes</content>
  </entry>
  <entry>
    <title>Pear Desktop 3.12.3</title>
    <link rel="alternate" type="text/html" href="https://github.com/michei69/pear-desktop/releases/tag/v3.12.3"/>
    <content type="html">stable notes</content>
  </entry>
</feed>`;

const channelFile = (version: string) =>
  `version: ${version}\nfiles: []\npath: pear-${version}.AppImage\nsha512: zzz\n`;

/**
 * Runs the real electron-updater GitHubProvider against a stub executor, with
 * the two flag combinations `applyChannel` produces.
 */
const runProvider = async (
  updateChannel: UpdateChannel,
  {
    missingBetaFile = false,
    platform = 'linux',
  }: { missingBetaFile?: boolean; platform?: string } = {},
) => {
  const requests: string[] = [];
  const executor = {
    request: async (options: { path: string }) => {
      const path = options.path;
      requests.push(path);
      if (path.endsWith('.atom')) return ATOM_FEED;
      if (path.endsWith('/releases/latest')) {
        return JSON.stringify({ tag_name: 'v3.12.3' });
      }
      if (/beta(-linux|-mac)?\.yml$/.test(path)) {
        if (missingBetaFile) throw new Error(`404 ${path}`);
        return channelFile('3.12.4-beta.1');
      }
      if (/latest(-linux|-mac)?\.yml$/.test(path)) return channelFile('3.12.3');
      throw new Error(`unexpected request: ${path}`);
    },
  };

  const provider = new GitHubProvider(
    { provider: 'github', owner: 'michei69', repo: 'pear-desktop' },
    {
      channel: updateChannel === 'beta' ? 'beta' : 'latest',
      allowPrerelease: updateChannel === 'beta',
      currentVersion: '3.12.3',
    },
    { platform, executor },
  );

  const info = await provider.getLatestVersion();
  return { requests, info };
};

test('item 1: allowPrerelease=false cannot return a prerelease', async () => {
  const { requests, info } = await runProvider('stable');

  // It asks GitHub for /releases/latest, which never points at a prerelease...
  expect(requests.some((path) => path.endsWith('/releases/latest'))).toBe(true);
  // ...and reads the stable channel file, even with the beta tag first in the feed.
  expect(requests.at(-1)).toBe(
    '/michei69/pear-desktop/releases/download/v3.12.3/latest-linux.yml',
  );
  expect(info.tag).toBe('v3.12.3');
  expect(info.version).toBe('3.12.3');
});

test('item 1: a beta tag makes the provider fetch the beta channel file', async () => {
  const { requests, info } = await runProvider('beta');

  expect(requests.at(-1)).toBe(
    '/michei69/pear-desktop/releases/download/v3.12.4-beta.1/beta-linux.yml',
  );
  expect(info.tag).toBe('v3.12.4-beta.1');
  expect(info.version).toBe('3.12.4-beta.1');
});

test('item 1: platform decides the channel file suffix', async () => {
  const { requests } = await runProvider('beta', { platform: 'win32' });
  expect(requests.at(-1)).toBe(
    '/michei69/pear-desktop/releases/download/v3.12.4-beta.1/beta.yml',
  );
  const mac = await runProvider('beta', { platform: 'darwin' });
  expect(mac.requests.at(-1)).toBe(
    '/michei69/pear-desktop/releases/download/v3.12.4-beta.1/beta-mac.yml',
  );
});

test('item 1 caveat: upstream falls back to latest.yml when beta.yml is missing', async () => {
  // app-updates.ts claims "a beta build never falls back to the stable feed",
  // but GitHubProvider.getLatestVersion retries the default channel file - on
  // the tag it resolved, so a beta release without beta*.yml is read as latest.
  const { requests, info } = await runProvider('beta', { missingBetaFile: true });
  expect(requests.at(-1)).toBe(
    '/michei69/pear-desktop/releases/download/v3.12.4-beta.1/latest-linux.yml',
  );
  expect(info.version).toBe('3.12.3');
});

// --------------------------------------------------------------- item 2 ---

test('item 2: a switch re-applies the feed and every check re-reads the store', () => {
  const setBody = slice(src.updates, 'export const setUpdateChannel =');
  const writeAt = setBody.indexOf("config.set('options.updateChannel', value)");
  const applyAt = setBody.indexOf('applyChannel(value)');
  expect(writeAt).toBeGreaterThanOrEqual(0);
  // Synchronously after the store write, before returning true.
  expect(applyAt).toBeGreaterThan(writeAt);
  expect(setBody.slice(applyAt, applyAt + 40)).not.toContain('await');
  expect(setBody.slice(applyAt)).toContain('return true;');

  const checkBody = slice(src.updates, 'export const checkForAppUpdates =');
  const reapplyAt = checkBody.indexOf('applyChannel(config.updateChannel())');
  const checkAt = checkBody.indexOf('runUpdateCheck()');
  expect(reapplyAt).toBeGreaterThanOrEqual(0);
  expect(checkAt).toBeGreaterThan(reapplyAt);

  // A channel changed while the window is open is applied by the watcher too.
  expect(src.updates).toContain('config.watch(');
});

/**
 * electron-updater resolves `checkForUpdates()` with the latest version's
 * `updateInfo` whether or not it is newer: AppUpdater.doCheckForUpdates returns
 * `{ isUpdateAvailable: false, versionInfo, updateInfo }` for the not-available
 * case. `checkForAppUpdates` gates the dialog on `result?.updateInfo`, so the
 * dialog is raised for a version the app already runs (and, on a beta build
 * whose feed falls back to latest.yml, for the older stable release).
 */
class StubUpdater extends AppUpdater {
  #latest: string;

  constructor(app: unknown, latest: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    super(null as any, app as any);
    this.#latest = latest;
    // The app sets this in setupAutoUpdates, so an available update must not
    // make the stub reach for a downloader it does not have.
    this.autoDownload = false;
  }

  async getUpdateInfoAndProvider() {
    return {
      info: { version: this.#latest, files: [] },
      provider: { setRequestHeaders() {} },
    };
  }
}

const fakeApp = {
  version: '3.12.3',
  isPackaged: true,
  whenReady: async () => {},
  getPath: () => tmpdir(),
  onQuit: () => {},
  quit: () => {},
};

test('item 2 BUG: a check with nothing to update still resolves updateInfo', async () => {
  const upToDate = new StubUpdater(fakeApp, '3.12.3');
  const result = await upToDate.checkForUpdates();

  expect(result?.isUpdateAvailable).toBe(false);
  // The app's gate is `if (result?.updateInfo && !dialogOpen)` - so this is
  // truthy and the "update available" dialog is shown anyway.
  expect(result?.updateInfo).toBeTruthy();
  expect(result?.updateInfo?.version).toBe('3.12.3');

  const older = new StubUpdater(fakeApp, '3.12.2');
  const downgrade = await older.checkForUpdates();
  expect(downgrade?.isUpdateAvailable).toBe(false);
  expect(downgrade?.updateInfo?.version).toBe('3.12.2');
});

/**
 * The rolling beta contract: a beta release is rebuilt in place, so the tag in
 * the feed changes with every run while only one prerelease entry ever exists.
 * A beta user must land on the newer beta.
 */
test('item 2: a beta user picks up the next beta from the rolling release', async () => {
  const nextBeta = '3.12.4-beta.42';
  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <link href="https://github.com/michei69/pear-desktop/releases/tag/v${nextBeta}"/>
    <title>Pear Desktop ${nextBeta} (beta)</title>
  </entry>
  <entry>
    <link href="https://github.com/michei69/pear-desktop/releases/tag/v3.12.3"/>
    <title>v3.12.3</title>
  </entry>
</feed>`;

  const requests: string[] = [];
  const executor = {
    request: async (options: { path: string }) => {
      requests.push(options.path);
      if (options.path.endsWith('.atom')) return feed;
      if (/beta(-linux|-mac)?\.yml$/.test(options.path)) {
        return channelFile(nextBeta);
      }
      throw new Error(`unexpected request: ${options.path}`);
    },
  };

  const provider = new GitHubProvider(
    { provider: 'github', owner: 'michei69', repo: 'pear-desktop' },
    { channel: 'beta', allowPrerelease: true, currentVersion: '3.12.4-beta.41' },
    { platform: 'linux', executor },
  );
  const info = await provider.getLatestVersion();

  // It followed the new beta entry, not the stable one beside it.
  expect(info.tag).toBe(`v${nextBeta}`);
  expect(info.version).toBe(nextBeta);
  expect(requests.at(-1)).toBe(
    `/michei69/pear-desktop/releases/download/v${nextBeta}/beta-linux.yml`,
  );

  // And the running beta is genuinely older, so the update is offered.
  const running = new StubUpdater(
    { ...fakeApp, version: '3.12.4-beta.41' },
    nextBeta,
  );
  const result = await running.checkForUpdates();
  expect(result?.isUpdateAvailable).toBe(true);
  expect(result?.updateInfo?.version).toBe(nextBeta);
});

test('item 2: the dialog only opens when an update is actually available', () => {
  const checkBody = slice(src.updates, 'export const runUpdateCheck =');
  // `updateInfo` is populated even when nothing newer exists (proven above), so
  // the gate has to be `isUpdateAvailable` or every launch announces an update.
  expect(checkBody).toMatch(/if \(isUpdateAvailable && updateInfo/);
  // A check that fails outright must not announce anything either.
  expect(checkBody).toContain('if (!outcome.ok) return;');
});

test('item 2: a running app looks again instead of only checking at launch', () => {
  const setupBody = slice(src.updates, 'export const setupAutoUpdates =');
  // The launch check alone would miss every beta published during a session.
  expect(setupBody).toContain('setInterval(');
  expect(setupBody).toContain('checkForAppUpdates()');
  // Turning auto-updates off has to stop it again.
  expect(setupBody).toContain('clearInterval(repeatCheck)');
});

test('item 2: a check is retried while a beta release is being replaced', () => {
  // The retry loop is shared with app-versions.ts, where it is unit-tested.
  const checkBody = slice(src.updates, 'export const runUpdateCheck =');
  expect(checkBody).toContain('withRetry(');
  expect(src.versions).toContain('CHECK_ATTEMPTS = 3');
});

// --------------------------------------------------------------- item 3 ---
test('item 3: switching a beta build to stable asks first and can be refused', () => {
  const setBody = slice(src.updates, 'export const setUpdateChannel =');
  expect(setBody).toMatch(
    /if \(isBetaVersion\(app\.getVersion\(\)\) && value === 'stable'\) \{\s*\n\s*if \(!\(await confirmDowngrade\(\)\)\) return false;/,
  );

  const confirmBody = slice(src.updates, 'const confirmDowngrade =');
  // Index 0 is the cancel button, and only index 1 (confirm) returns true.
  expect(confirmBody).toContain('cancelId: 0');
  expect(confirmBody).toContain('return answer.response === 1;');
});

test('item 3: every i18n key app-updates.ts asks for resolves in en.json', async () => {
  const instance = await i18n();
  const keys = i18nKeysIn('src/providers/app-updates.ts');
  expect(keys.length).toBeGreaterThanOrEqual(15);

  // The check is only meaningful if a missing key really does come back as-is.
  expect(instance.t('definitely.not.a.key')).toBe('definitely.not.a.key');

  const missing = keys.filter((key) => instance.t(key) === key);
  expect(missing, 'keys with no English translation').toEqual([]);
});

test('item 3: the downgrade dialog keys in particular resolve', async () => {
  const instance = await i18n();
  const keys = [
    'main.dialog.downgrade-warning.title',
    'main.dialog.downgrade-warning.message',
    'main.dialog.downgrade-warning.detail',
    'main.dialog.downgrade-warning.cancel',
    'main.dialog.downgrade-warning.confirm',
  ];
  expect(keys.filter((key) => instance.t(key) === key)).toEqual([]);
});

// --------------------------------------------------------------- item 4 ---

test('item 4: semver needs the base version to satisfy a migration range', () => {
  expect(migrationBaseVersion('3.12.4-beta.1')).toBe('3.12.4');
  expect(migrationBaseVersion('3.12.4')).toBe('3.12.4');
  expect(migrationBaseVersion('3.12.4-beta.1')).toBe(
    migrationBaseVersion('3.12.4'),
  );

  // The trap the split avoids: semver excludes prereleases from plain ranges.
  expect(semver.satisfies('3.12.4-beta.1', '>=3.12.4')).toBe(false);
  expect(semver.satisfies(migrationBaseVersion('3.12.4-beta.1'), '>=3.12.4')).toBe(
    true,
  );
  // And the marker a beta run leaves behind satisfies the same range.
  expect(semver.satisfies('3.12.4', '>=3.12.4')).toBe(true);
  expect(semver.satisfies('3.12.3', '>=3.12.4')).toBe(false);
});

/** The channel the file held before defaults were written, as store.ts reads it. */
const channelBeforeDefaults = (cwd: string) => {
  try {
    const stored = JSON.parse(
      readFileSync(join(cwd, 'config.json'), 'utf8'),
    ) as { options?: { updateChannel?: unknown } };
    const channel = stored.options?.updateChannel;
    return channel === 'stable' || channel === 'beta' ? channel : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Mirror of the '>=3.12.4' migration in src/config/store.ts (asserted below).
 * `conf` writes the defaults into the file before migrations run, so the
 * pre-defaults value has to be captured before the store is created - inside
 * the migration, `options.updateChannel` always reads back as `stable`.
 */
const seedUpdateChannel =
  (buildChannel: UpdateChannel, before: 'stable' | 'beta' | undefined) =>
  (store: Conf<Record<string, unknown>>) => {
    if (before === undefined) {
      store.set('options.updateChannel', defaultUpdateChannel(buildChannel));
    }
  };

/** `conf` is the engine behind electron-store: same options, no electron. */
const openStore = (
  cwd: string,
  projectVersion: string,
  migrations: Record<string, (store: Conf<Record<string, unknown>>) => void>,
) =>
  new Conf<Record<string, unknown>>({
    cwd,
    configName: 'config',
    defaults: defaultConfig as unknown as Record<string, unknown>,
    clearInvalidConfig: false,
    migrations,
    projectVersion,
  });

const markerOf = (store: Conf<Record<string, unknown>>) =>
  store.get('__internal__.migrations.version');

const withTempStore = (run: (cwd: string) => void) => {
  const cwd = mkdtempSync(join(tmpdir(), 'pear-update-channel-'));
  try {
    run(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
};

test('item 4: store.ts still seeds the channel from a 3.12.4 migration', () => {
  expect(src.store).toMatch(/'>=3\.12\.4'\(store: IStore\) \{/);
  expect(src.store).toContain('if (channelBeforeDefaults === undefined) {');
  // The capture must happen before the store is constructed, or it reads the
  // defaults back instead of what the user chose.
  expect(src.store).toMatch(
    /channelBeforeDefaults = readStoredChannel\(\s*join\(app\.getPath\('userData'\), 'config\.json'\),\s*\);/,
  );
  expect(src.store).toContain(
    "store.set('options.updateChannel', defaultUpdateChannel());",
  );
  expect(src.store).toContain(
    'projectVersion: migrationBaseVersion(packageJson.version)',
  );
});

test('item 4: an existing store is seeded from the build channel', () => {
  withTempStore((cwd) => {
    writeFileSync(
      join(cwd, 'config.json'),
      JSON.stringify({
        options: { tray: true },
        __internal__: { migrations: { version: '3.12.3' } },
      }),
    );

    const beta = openStore(cwd, '3.12.4', {
      '>=3.12.4': seedUpdateChannel('beta', channelBeforeDefaults(cwd)),
    });
    expect(beta.get('options.updateChannel')).toBe('beta');
    // The marker becomes the base version, not the range key.
    expect(markerOf(beta)).toBe('3.12.4');
  });
});

test('item 4: the 3.12.4 release does not re-run the beta migration', () => {
  withTempStore((cwd) => {
    writeFileSync(
      join(cwd, 'config.json'),
      JSON.stringify({
        options: { tray: true },
        __internal__: { migrations: { version: '3.12.3' } },
      }),
    );

    const beta = openStore(cwd, '3.12.4', {
      '>=3.12.4': seedUpdateChannel('beta', channelBeforeDefaults(cwd)),
    });
    expect(beta.get('options.updateChannel')).toBe('beta');

    // The user moves back to stable; the same store reopened by 3.12.4 stable
    // (or by a later beta) keeps the choice instead of re-seeding.
    beta.set('options.updateChannel', 'stable');
    const stable = openStore(cwd, '3.12.4', {
      '>=3.12.4': seedUpdateChannel('stable', channelBeforeDefaults(cwd)),
    });
    expect(stable.get('options.updateChannel')).toBe('stable');
    expect(markerOf(stable)).toBe('3.12.4');
  });
});

test('item 4: a satisfied older marker does not run its migration twice', () => {
  withTempStore((cwd) => {
    writeFileSync(
      join(cwd, 'config.json'),
      JSON.stringify({
        options: {},
        __internal__: { migrations: { version: '3.12.3' } },
      }),
    );
    const runs = (store: Conf<Record<string, unknown>>) =>
      store.set('ran3123', (store.get('ran3123') ?? 0) + 1);

    // Marker 3.12.3 already satisfies '>=3.12.3', so only '>=3.12.4' runs.
    const first = openStore(cwd, '3.12.4', {
      '>=3.12.3': runs,
      '>=3.12.4': seedUpdateChannel('stable', channelBeforeDefaults(cwd)),
    });
    expect(first.get('ran3123')).toBeUndefined();
    expect(markerOf(first)).toBe('3.12.4');

    // Reopened at the same version, nothing runs again either.
    const second = openStore(cwd, '3.12.4', {
      '>=3.12.3': runs,
      '>=3.12.4': seedUpdateChannel('stable', channelBeforeDefaults(cwd)),
    });
    expect(second.get('ran3123')).toBeUndefined();
    expect(markerOf(second)).toBe('3.12.4');
  });
});

test('item 4: a fresh beta install starts on the beta channel', () => {
  // The trap: the store defaults already write 'stable' into the file before
  // migrations run, so the seed has to look at the file as it was beforehand.
  expect(defaultUpdateChannel('beta')).toBe('beta');
  withTempStore((cwd) => {
    const fresh = openStore(cwd, '3.12.4', {
      '>=3.12.4': seedUpdateChannel('beta', channelBeforeDefaults(cwd)),
    });
    expect(fresh.get('options.updateChannel')).toBe('beta');
  });
});

test('item 4: a fresh stable install starts on the stable channel', () => {
  withTempStore((cwd) => {
    const fresh = openStore(cwd, '3.12.4', {
      '>=3.12.4': seedUpdateChannel('stable', channelBeforeDefaults(cwd)),
    });
    expect(fresh.get('options.updateChannel')).toBe('stable');
  });
});

test('item 4: a channel the user already chose survives the seed', () => {
  withTempStore((cwd) => {
    writeFileSync(
      join(cwd, 'config.json'),
      JSON.stringify({ options: { updateChannel: 'stable' } }),
    );
    const kept = openStore(cwd, '3.12.4', {
      '>=3.12.4': seedUpdateChannel('beta', channelBeforeDefaults(cwd)),
    });
    expect(kept.get('options.updateChannel')).toBe('stable');
  });
});

// --------------------------------------------------------------- item 5 ---

test('item 5: dev builds support no updates, packaged builds do', () => {
  expect(updatesSupported('dev')).toBe(false);
  expect(updatesSupported('stable')).toBe(true);
  expect(updatesSupported('beta')).toBe(true);
  expect(defaultUpdateChannel('dev')).toBe('stable');
  expect(defaultUpdateChannel('beta')).toBe('beta');
});

test('item 5: the menu hides the whole Updates submenu on a dev build', () => {
  const options = slice(src.menu, "label: t('main.menu.options.label')");
  expect(options.slice(0, 2000)).toContain('...((updatesSupported()');
  // Nothing update-related outside that spread.
  expect(src.menu).toContain('checkForAppUpdates');
  expect(src.menu).toContain('setUpdateChannel(value)');
});

test('item 5: the settings About fields hide themselves on a dev build', () => {
  expect(src.settings).toContain(
    'visible: () => store()?.updates?.supported === true',
  );
  const about = slice(src.settings, "id: 'about'");
  const updateFields = about.slice(0, about.indexOf('UPDATES_ONLY'));
  expect(updateFields).toContain("'options.autoUpdates'");
  // Both the auto-update toggle and the channel select carry the gate.
  expect(about.slice(0, 2000).match(/\bUPDATES_ONLY\b/g)?.length).toBe(2);
  // ...and the modal actually honours `visible`.
  expect(read('src/plugins/settings-ui/components/SettingsModal.tsx')).toContain(
    'field.visible?.() ?? true',
  );
});

test('item 5: a dev build still reports a stale commit', () => {
  const dev = slice(src.updates, 'const checkDevCommit =');
  expect(dev).toContain('isCommitBehindMaster(comparison)');
  expect(src.updates).toContain('if (!updatesSupported()) {');
  expect(src.updates).toContain('await checkDevCommit();');
});

test('item 5: the dev notice and downgrade dialog keys resolve', async () => {
  const instance = await i18n();
  const keys = [
    ...i18nKeysIn('src/providers/app-updates.ts').filter((key) =>
      key.startsWith('main.dialog.update-available-dev.'),
    ),
    ...i18nKeysIn('src/menu.ts').filter((key) => key.includes('updates')),
    ...menuLabelKeysIn('src/plugins/settings-ui/schema/app-settings.ts').filter(
      (key) => key.includes('updates'),
    ),
    // Built from a template in menu.ts.
    'main.menu.options.submenu.updates.channel.stable',
    'main.menu.options.submenu.updates.channel.beta',
  ];
  expect(keys.length).toBeGreaterThan(8);
  expect(keys.filter((key) => instance.t(key) === key)).toEqual([]);
});
