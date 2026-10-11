/**
 * Update channels (stable/beta), auto-updates and beta-aware migrations.
 * Offline and electron-free, but runs real code: the app's own pure functions,
 * `conf` for store migrations, and the real electron-updater provider on a stub network.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import Conf from 'conf';
import { AppUpdater } from 'electron-updater';
import { GitHubProvider } from 'electron-updater/out/providers/GitHubProvider.js';
import semver from 'semver';

import { defaultUpdateChannel, updatesSupported } from '../src/app-info';
import { defaultConfig } from '../src/config/defaults';
import { migrationBaseVersion } from '../src/providers/app-versions';

import type { UpdateChannel } from '../src/app-info';

// --------------------------------------------------------------- item 1 ---
// Stable vs beta feed selection, driven through the real provider with the flag
// combinations `applyChannel` sets: the flags must mean what electron-updater says.

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

// Runs the real GitHubProvider against a stub executor with the flag
// combinations `applyChannel` produces.
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
  // app-updates.ts claims "a beta build never falls back to the stable feed", but
  // GitHubProvider.getLatestVersion retries the default channel file on the resolved tag.
  const { requests, info } = await runProvider('beta', { missingBetaFile: true });
  expect(requests.at(-1)).toBe(
    '/michei69/pear-desktop/releases/download/v3.12.4-beta.1/latest-linux.yml',
  );
  expect(info.version).toBe('3.12.3');
});

// --------------------------------------------------------------- item 2 ---

// electron-updater resolves `checkForUpdates()` with the latest version's
// `updateInfo` even when it is not newer, and `checkForAppUpdates` gates the
// dialog on `result?.updateInfo` - so it opens for a version already running.
class StubUpdater extends AppUpdater {
  #latest: string;

  constructor(app: unknown, latest: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    super(null as any, app as any);
    this.#latest = latest;
    // The app sets this in setupAutoUpdates; an available update must not make
    // the stub reach for a downloader it lacks.
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
  // The app's gate is `if (result?.updateInfo && !dialogOpen)`, so this truthy
  // value shows the "update available" dialog anyway.
  expect(result?.updateInfo).toBeTruthy();
  expect(result?.updateInfo?.version).toBe('3.12.3');

  const older = new StubUpdater(fakeApp, '3.12.2');
  const downgrade = await older.checkForUpdates();
  expect(downgrade?.isUpdateAvailable).toBe(false);
  expect(downgrade?.updateInfo?.version).toBe('3.12.2');
});

// Rolling beta contract: the release is rebuilt in place, so its tag changes every
// run while one prerelease entry exists; a beta user must land on the newer beta.
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

// Mirror of the '>=3.12.4' migration in src/config/store.ts: seeds the channel
// the build follows unless the user already chose one. `conf` writes defaults
// before migrations run, so the pre-defaults value is captured beforehand.
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

    // The user moves back to stable; reopening the store keeps the choice
    // instead of re-seeding.
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
  // The store defaults write 'stable' before migrations run, so the seed has to
  // read the file as it was beforehand.
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
