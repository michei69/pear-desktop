import packageJson from '../package.json' with { type: 'json' };

/**
 * How a build was produced:
 * - `stable`: built by the release workflow, published as a versioned release.
 * - `beta`: built from master on every push, published as the rolling `beta` release.
 * - `dev`: anything unbaked, i.e. `pnpm dev` and local builds.
 */
export type Channel = 'stable' | 'beta' | 'dev';

/** The release line a build follows; dev builds never auto-update. */
export type UpdateChannel = 'stable' | 'beta';

// Replaced by the bundler (see electron.vite.config.mts); undefined when unbaked.
declare const __PEAR_CHANNEL__: Channel | undefined;
declare const __PEAR_COMMIT__: string | undefined;

export const channel: Channel =
  typeof __PEAR_CHANNEL__ === 'string' ? __PEAR_CHANNEL__ : 'dev';

/** Short commit the build came from, or empty when it was not built from a git checkout. */
export const commit: string =
  typeof __PEAR_COMMIT__ === 'string' ? __PEAR_COMMIT__ : '';

/** `beta 1a2b3c4` for beta and dev, plain `stable` otherwise: the release tag is the version. */
export const buildLabel = (ch: Channel = channel, sha: string = commit) =>
  ch === 'stable' || !sha ? ch : `${ch} ${sha}`;

/** Only packaged builds have a channel to update along; dev builds have none. */
export const updatesSupported = (ch: Channel = channel) => ch !== 'dev';

/** Where an unbaked build should start out before the user picks a channel. */
export const defaultUpdateChannel = (ch: Channel = channel): UpdateChannel =>
  ch === 'beta' ? 'beta' : 'stable';

const holder = ({ name, email }: { email?: string; name: string }) =>
  `Copyright (c) ${name}${email ? ` <${email}>` : ''}`;

/** One line per holder, upstream first. */
export const copyright = [packageJson.author, ...packageJson.contributors]
  .map(holder)
  .join('\n');
