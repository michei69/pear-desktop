import { deepmerge } from 'deepmerge-ts';

import type { PluginConfig, PluginDef } from '@/types/plugins';

/**
 * A plugin's declared defaults merged with its stored config. Pure on purpose:
 * the renderer and preload loaders import this module too, and neither may pull
 * in the main-process store. Use `@/config/plugins` on the main side.
 */
export const mergePluginConfig = <Config extends PluginConfig>(
  defaults: PluginDef<unknown, unknown, unknown, Config>['config'] | undefined,
  stored: unknown,
): Config =>
  deepmerge(defaults ?? { enabled: false }, (stored ?? {}) as object) as Config;
