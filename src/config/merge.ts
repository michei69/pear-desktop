import { deepmerge } from 'deepmerge-ts';

import type { PluginConfig, PluginDef } from '@/types/plugins';

// HACK: keep this module free of main-process imports; the renderer and
// preload loaders import it and must not pull the electron store.
export const mergePluginConfig = <Config extends PluginConfig>(
  defaults: PluginDef<unknown, unknown, unknown, Config>['config'] | undefined,
  stored: unknown,
): Config =>
  deepmerge(defaults ?? { enabled: false }, (stored ?? {}) as object) as Config;
