import { prerelease } from 'semver';

/** Whether a version carries a prerelease tag, e.g. `3.12.4-beta.1`. */
export const isBetaVersion = (version: string): boolean =>
  prerelease(version)?.[0] === 'beta';

/**
 * A prerelease and its release share a schema, so migrations key off the part
 * before `-`: 3.12.4-beta.1 migrates as 3.12.4 would, and the marker stays equal
 * when 3.12.4 later reads the same store.
 */
export const migrationBaseVersion = (version: string): string =>
  version.split('-')[0];

/**
 * Beta version for a build number, from the release it leads up to: `3.12.4`
 * and run 42 give `3.12.4-beta.42`. A release sorts above all its betas, so
 * shipping `3.12.4` upgrades the whole beta channel with no special case.
 * Keep in step with the "Stamp beta version" step in build.yml.
 */
export const betaVersion = (release: string, runNumber: number): string =>
  `${migrationBaseVersion(release)}-beta.${runNumber}`;

/** Result of the GitHub compare API for the running dev commit. */
export interface CommitComparison {
  status: string;
  ahead_by: number;
  behind_by: number;
}

/** A dev build is stale when the checkout it was built from trails master. */
export const isCommitBehindMaster = (
  comparison: CommitComparison | null | undefined,
): boolean =>
  comparison?.status === 'behind' || (comparison?.behind_by ?? 0) > 0;

/** Attempts and spacing for a check that fails transiently. */
export const CHECK_ATTEMPTS = 3;
export const CHECK_RETRY_MS = 5000;

/**
 * Runs `attempt`, retrying a throw a couple of times and reporting whether it
 * ever succeeded. A beta release is replaced in place, so a check landing
 * between the old release being deleted and the new one appearing sees a feed
 * entry whose `beta.yml` is already gone — a failure worth waiting out.
 */
export const withRetry = async <T>(
  attempt: () => Promise<T>,
  onFailure: (error: unknown, attempt: number, last: boolean) => void,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<{ ok: true; value: T } | { ok: false }> => {
  for (let n = 1; n <= CHECK_ATTEMPTS; n++) {
    try {
      return { ok: true, value: await attempt() };
    } catch (error) {
      const last = n === CHECK_ATTEMPTS;
      onFailure(error, n, last);
      if (last) return { ok: false };
      await wait(CHECK_RETRY_MS);
    }
  }

  return { ok: false };
};
