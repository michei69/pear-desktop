import { expect, test } from '@playwright/test';
import semver from 'semver';

import {
  CHECK_ATTEMPTS,
  CHECK_RETRY_MS,
  betaVersion,
  isBetaVersion,
  isCommitBehindMaster,
  migrationBaseVersion,
  withRetry,
} from '../src/providers/app-versions';

// A prerelease and its release share a schema, so every migration decision has
// to be made on the part before `-`.

test('a beta and its release share a migration base version', () => {
  expect(migrationBaseVersion('3.12.4-beta.1')).toBe('3.12.4');
  expect(migrationBaseVersion('3.12.4')).toBe('3.12.4');
  expect(migrationBaseVersion('3.12.4-beta.1')).toBe(
    migrationBaseVersion('3.12.4'),
  );
});

test('build metadata is stripped with the prerelease', () => {
  expect(migrationBaseVersion('3.12.4-beta.7+1a2b3c4')).toBe('3.12.4');
});

test('only the beta tag counts as a beta version', () => {
  expect(isBetaVersion('3.12.4-beta.1')).toBe(true);
  expect(isBetaVersion('3.12.4')).toBe(false);
  // Other prerelease tags are not the beta channel.
  expect(isBetaVersion('3.12.4-rc.1')).toBe(false);
  expect(isBetaVersion('3.12.4-alpha.1')).toBe(false);
});

test('a dev build is behind master when it trails or has fallen behind', () => {
  expect(
    isCommitBehindMaster({ status: 'behind', ahead_by: 0, behind_by: 4 }),
  ).toBe(true);
  expect(
    isCommitBehindMaster({ status: 'identical', ahead_by: 0, behind_by: 0 }),
  ).toBe(false);
  expect(
    isCommitBehindMaster({ status: 'ahead', ahead_by: 3, behind_by: 0 }),
  ).toBe(false);
  // A diverged build still carries commits master has, which counts as behind.
  expect(
    isCommitBehindMaster({ status: 'diverged', ahead_by: 2, behind_by: 1 }),
  ).toBe(true);
});

test('a failed or empty compare never claims an update', () => {
  expect(isCommitBehindMaster(null)).toBe(false);
  expect(isCommitBehindMaster(undefined)).toBe(false);
});

// The beta scheme: package.json names the release the betas lead up to, and the
// workflow only appends the run number.
test('a beta is named after the release it leads up to', () => {
  expect(betaVersion('3.12.4', 42)).toBe('3.12.4-beta.42');
  expect(betaVersion('3.12.4', 1)).toBe('3.12.4-beta.1');
  // Re-stamping an already stamped version must not double the suffix.
  expect(betaVersion('3.12.4-beta.7', 42)).toBe('3.12.4-beta.42');
});

test('releasing the version upgrades every beta of it', () => {
  const release = '3.12.4';
  const beta = betaVersion(release, 42);

  // Later betas upgrade earlier ones...
  expect(semver.gt(beta, betaVersion(release, 7))).toBe(true);
  // ...and the release upgrades all of them, which is what lets a beta user
  // move to stable without reinstalling.
  expect(semver.gt(release, beta)).toBe(true);
  // The same release never re-offers its own betas.
  expect(semver.gt(beta, release)).toBe(false);
  // And the channel split still reads the prerelease as `beta`.
  expect(isBetaVersion(beta)).toBe(true);
});

// A beta release is replaced in place, so a check can land in the window where
// the feed still names the old tag but its beta.yml is already gone.
test('a failing check is retried, then gives up quietly', async () => {
  const waits: number[] = [];
  const wait = async (ms: number) => {
    waits.push(ms);
  };
  const attempts: number[] = [];
  const failures: boolean[] = [];

  const outcome = await withRetry(
    async () => {
      attempts.push(attempts.length + 1);
      throw new Error('404 beta.yml');
    },
    (_err, _attempt, last) => failures.push(last),
    wait,
  );

  expect(outcome.ok).toBe(false);
  expect(attempts).toHaveLength(CHECK_ATTEMPTS);
  // Only the final failure is flagged as the last one.
  expect(failures).toEqual([false, false, true]);
  // Backs off between tries, and not after the last one.
  expect(waits).toEqual([CHECK_RETRY_MS, CHECK_RETRY_MS]);
});

test('a check that succeeds on a retry is not retried further', async () => {
  let n = 0;
  const outcome = await withRetry(
    async () => {
      n++;
      if (n === 1) throw new Error('transient');
      return 'latest';
    },
    () => {},
    async () => {},
  );

  expect(outcome).toEqual({ ok: true, value: 'latest' });
  expect(n).toBe(2);
});

test('a check that succeeds first time waits for nothing', async () => {
  const waits: number[] = [];
  const outcome = await withRetry(
    async () => 'latest',
    () => {},
    async (ms) => {
      waits.push(ms);
    },
  );

  expect(outcome).toEqual({ ok: true, value: 'latest' });
  expect(waits).toEqual([]);
});
