/**
 * The store's migrations, kept electron-free so the tests can drive them:
 * `store.ts` builds a real store the moment it is imported. `store.ts` wires
 * these to the build environment.
 */
import { readFileSync } from 'node:fs';

import {
  defaultUpdateChannel,
  type Channel,
  type UpdateChannel,
} from '../app-info';
import {
  blockers,
  isLegacyCustomBlocker,
  normalizeBlocker,
} from '../plugins/do-not-track/types';
import { DefaultPresetList, type Preset } from '../plugins/downloader/types';

import type { TrackerBlockerConfig } from '../plugins/do-not-track';
import type { SyncedLyricsPluginConfig } from '../plugins/synced-lyrics/types';
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

export type MigrationEnvironment = {
  buildChannel: Channel;
  channelBeforeDefaults: UpdateChannel | undefined;
};

/**
 * Every migration the store runs, oldest first: `conf` applies the applicable
 * keys in the order they appear in this object, so a later migration may rely
 * on an earlier one having converted the store to the current shape.
 */
export const createMigrations = ({
  buildChannel,
  channelBeforeDefaults,
}: MigrationEnvironment) => ({
  // Converts the old list of enabled plugin ids into the per-plugin config
  // object every later migration operates on.
  '>=1.7.0'(store: IStore) {
    const enabledPlugins = store.get('plugins') as string[];
    if (!Array.isArray(enabledPlugins)) return;

    // Include custom options
    // oxlint-disable-next-line typescript/no-explicit-any
    const plugins: Record<string, any> = {
      adblocker: {
        enabled: true,
        cache: true,
        additionalBlockLists: [],
      },
      downloader: {
        enabled: false,
        ffmpegArgs: [], // E.g. ["-b:a", "192k"] for an audio bitrate of 192kb/s
        downloadFolder: undefined, // Custom download folder (absolute path)
      },
    };

    for (const enabledPlugin of enabledPlugins) {
      // oxlint-disable-next-line typescript/no-unsafe-assignment
      plugins[enabledPlugin] = {
        ...plugins[enabledPlugin],
        enabled: true,
      };
    }

    store.set('plugins', plugins);
  },
  '>=1.11.0'(store: IStore) {
    if (store.get('options.resumeOnStart') === undefined) {
      store.set('options.resumeOnStart', true);
    }
  },
  '>=1.12.0'(store: IStore) {
    const options = store.get('plugins.shortcuts') as
      | Record<
          string,
          | {
              action: string;
              shortcut: unknown;
            }[]
          | Record<string, unknown>
        >
      | undefined;
    if (options) {
      let updated = false;
      for (const optionType of ['global', 'local']) {
        if (
          Object.hasOwn(options, optionType) &&
          Array.isArray(options[optionType])
        ) {
          const optionsArray = options[optionType] as {
            action: string;
            shortcut: unknown;
          }[];
          const updatedOptions: Record<string, unknown> = {};
          for (const optionObject of optionsArray) {
            if (optionObject.action && optionObject.shortcut) {
              updatedOptions[optionObject.action] = optionObject.shortcut;
            }
          }

          options[optionType] = updatedOptions;
          updated = true;
        }
      }
      if (updated) {
        store.set('plugins.shortcuts', options);
      }
    }
  },
  '>=1.13.0'(store: IStore) {
    if (store.get('plugins.discord.listenAlong') === undefined) {
      store.set('plugins.discord.listenAlong', true);
    }
  },
  '>=1.14.0'(store: IStore) {
    if (
      typeof store.get('plugins.precise-volume.globalShortcuts') !== 'object'
    ) {
      store.set('plugins.precise-volume.globalShortcuts', {});
    }

    if (store.get('plugins.hide-video-player.enabled')) {
      store.delete('plugins.hide-video-player');
      store.set('plugins.video-toggle.enabled', true);
    }
  },
  '>=1.17.0'(store: IStore) {
    store.delete('plugins.picture-in-picture'); // default value is now in the plugin

    if (store.get('plugins.video-toggle.mode') === undefined) {
      store.set('plugins.video-toggle.mode', 'custom');
    }
  },
  '>=1.20.0'(store: IStore) {
    store.delete('plugins.visualizer'); // default value is now in the plugin

    if (store.get('plugins.notifications.toastStyle') === undefined) {
      const pluginOptions = store.get('plugins.notifications') || {};
      store.set('plugins.notifications', {
        ...pluginOptions,
      });
    }

    if (store.get('options.ForceShowLikeButtons')) {
      store.delete('options.ForceShowLikeButtons');
      store.set('options.likeButtons', 'force');
    }
  },
  '>=2.1.0'(store: IStore) {
    const originalPreset = store.get('plugins.downloader.preset') as
      | string
      | undefined;
    if (originalPreset) {
      if (originalPreset !== 'opus') {
        store.set('plugins.downloader.selectedPreset', 'Custom');
        store.set('plugins.downloader.customPresetSetting', {
          extension: 'mp3',
          ffmpegArgs:
            (store.get('plugins.downloader.ffmpegArgs') as string[]) ??
            DefaultPresetList['mp3 (256kbps)'].ffmpegArgs,
        } satisfies Preset);
      } else {
        store.set('plugins.downloader.selectedPreset', 'Source');
        store.set('plugins.downloader.customPresetSetting', {
          extension: null,
          ffmpegArgs:
            (store.get('plugins.downloader.ffmpegArgs') as string[]) ?? [],
        } satisfies Preset);
      }
      store.delete('plugins.downloader.preset');
      store.delete('plugins.downloader.ffmpegArgs');
    }
  },
  '>=2.1.3'(store: IStore) {
    const listenAlong = store.get('plugins.discord.listenAlong');
    if (listenAlong !== undefined) {
      store.set(
        'plugins.discord.playOn\u0059\u006f\u0075\u0054\u0075\u0062\u0065\u004d\u0075\u0073\u0069\u0063',
        listenAlong,
      );
      store.delete('plugins.discord.listenAlong');
    }
  },
  '>=3.0.0'(store: IStore) {
    const discordConfig = store.get('plugins.discord') as Record<
      string,
      unknown
    >;
    if (discordConfig) {
      const oldActivityTimoutEnabled = store.get(
        'plugins.discord.activityTimoutEnabled',
      ) as boolean | undefined;
      const oldActivityTimoutTime = store.get(
        'plugins.discord.activityTimoutTime',
      ) as number | undefined;
      if (oldActivityTimoutEnabled !== undefined) {
        discordConfig.activityTimeoutEnabled = oldActivityTimoutEnabled;
        store.set('plugins.discord', discordConfig);
      }
      if (oldActivityTimoutTime !== undefined) {
        discordConfig.activityTimeoutTime = oldActivityTimoutTime;
        store.set('plugins.discord', discordConfig);
      }
    }
  },
  '>=3.3.0'(store: IStore) {
    const lastfmConfig = store.get('plugins.lastfm') as {
      enabled?: boolean;
      token?: string;
      session_key?: string;
      api_root?: string;
      api_key?: string;
      secret?: string;
    };
    if (lastfmConfig) {
      let scrobblerConfig = store.get('plugins.scrobbler') as
        | {
            enabled?: boolean;
            scrobblers?: {
              lastfm?: {
                enabled?: boolean;
                token?: string;
                sessionKey?: string;
                apiRoot?: string;
                apiKey?: string;
                secret?: string;
              };
            };
          }
        | undefined;

      if (!scrobblerConfig) {
        scrobblerConfig = {
          enabled: lastfmConfig.enabled,
        };
      }

      if (!scrobblerConfig.scrobblers) {
        scrobblerConfig.scrobblers = {
          lastfm: {},
        };
      }

      scrobblerConfig.scrobblers.lastfm = {
        enabled: lastfmConfig.enabled,
        token: lastfmConfig.token,
        sessionKey: lastfmConfig.session_key,
        apiRoot: lastfmConfig.api_root,
        apiKey: lastfmConfig.api_key,
        secret: lastfmConfig.secret,
      };
      store.set('plugins.scrobbler', scrobblerConfig);
      store.delete('plugins.lastfm');
    }
  },
  '>=3.10.0'(store: IStore) {
    const lyricGeniusConfig = store.get('plugins.lyrics-genius') as
      | {
          enabled?: boolean;
          romanizedLyrics?: boolean;
        }
      | undefined;

    if (lyricGeniusConfig) {
      const syncedLyricsConfig = store.get('plugins.synced-lyrics') as
        | SyncedLyricsPluginConfig
        | undefined;

      if (
        !syncedLyricsConfig ||
        syncedLyricsConfig?.enabled !== lyricGeniusConfig?.enabled
      ) {
        store.set('plugins.synced-lyrics', {
          ...syncedLyricsConfig,
          enabled: lyricGeniusConfig.enabled,
        });
      }

      store.delete('plugins.lyrics-genius');
    }
  },
  '>=3.12.0'(store: IStore) {
    const blockerConfig = store.get(
      'plugins.adblocker',
    ) as TrackerBlockerConfig;
    if (blockerConfig) {
      if (!Object.values(blockers).includes(blockerConfig.blocker)) {
        blockerConfig.customEnabled = isLegacyCustomBlocker(
          blockerConfig.blocker,
        );
        blockerConfig.blocker = normalizeBlocker(blockerConfig.blocker);
      }
      store.set('plugins.do-not-track', blockerConfig);
      store.delete('plugins.adblocker');
    }
  },
  '>=3.12.3'(store: IStore) {
    // Synced lyrics' single "preferred provider" became an orderable priority
    // list led by it; "None" leaves the list off, the old "let the lyrics decide".
    const syncedLyricsConfig = store.get('plugins.synced-lyrics') as
      | Record<string, unknown>
      | undefined;
    const preferredProvider = syncedLyricsConfig?.preferredProvider;
    if (
      !syncedLyricsConfig ||
      syncedLyricsConfig.providerPriority !== undefined ||
      preferredProvider === undefined
    ) {
      return;
    }

    // Retired either way, so drop it even when it held "None".
    delete syncedLyricsConfig.preferredProvider;
    if (typeof preferredProvider === 'string') {
      syncedLyricsConfig.providerPriority = [preferredProvider];
      syncedLyricsConfig.usePriorityList = true;
    }

    store.set('plugins.synced-lyrics', syncedLyricsConfig);
  },
  // A beta build should follow the beta channel from the start, without
  // overriding a channel the user already picked: `channelBeforeDefaults` is
  // what says whether the user chose. Also drops the keys this build no longer
  // has: the GPU option and three removed plugins. Deleting only when present
  // keeps a config that never had them untouched.
  '>=3.12.4'(store: IStore) {
    seedUpdateChannel(buildChannel, channelBeforeDefaults)(store);

    store.delete('options.inProcessGpu');
    for (const id of [
      'skip-disliked-songs',
      'compact-sidebar',
      'custom-theme',
    ]) {
      store.delete(`plugins.${id}`);
    }
  },
  // The one performance mode toggle became a switch per part; a config written
  // before the split still holds the boolean, while the store default is the
  // object and skips it.
  '>=3.13.0'(store: IStore) {
    const performanceMode = store.get('options.performanceMode');
    if (typeof performanceMode !== 'boolean') return;

    store.set('options.performanceMode', {
      flags: performanceMode,
      css: performanceMode,
      animations: performanceMode,
      plugins: performanceMode,
    });
  },
});
