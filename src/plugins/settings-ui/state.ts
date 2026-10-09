import { deepmergeCustom } from 'deepmerge-ts';
import { createSignal } from 'solid-js';

import {
  CUSTOM_PRESET,
  defaultPreset,
  presetPalette,
  resolvePalette,
  type PearTheme,
  type ThemePalette,
  type ThemePresets,
  type ThemeState,
} from '@/themes/types';

import { getByPath, nestPartial, setByPath } from './paths';

import type { UpdateChannel } from '@/app-info';
import type { defaultConfig } from '@/config/defaults';
import type { RendererContext } from '@/types/contexts';
import type { RestartRequirement } from '@/types/restart';

/** The stored config, plus what the backend reports about updates. */
export type StoreShape = typeof defaultConfig & {
  updates: {
    /** False on dev builds, which have no updater at all. */
    supported: boolean;
    /** The release line the app updates along. */
    channel: UpdateChannel;
    /** The line this build came from, which the user may switch away from. */
    buildChannel: UpdateChannel;
  };
};
export type PluginConfigMap = Record<
  string,
  Record<string, unknown> & { enabled?: boolean }
>;

export interface AppMeta {
  name: string;
  version: string;
  /** Channel and commit, e.g. `stable` or `beta 1a2b3c4`. */
  build: string;
  /** One line per copyright holder. */
  copyright: string;
  platform: string;
  arch: string;
  osVersion: string;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
  cpu: {
    model: string;
    threads: number;
  };
  gpu: {
    renderer?: string;
    vendor?: string;
    driver?: string;
    /** From app.getGPUFeatureStatus(), e.g. `{ gpu_compositing: 'enabled' }`. */
    features: Record<string, string>;
  };
  /** Working set in kilobytes, per process group. */
  memory: {
    main: number;
    renderers: number;
    gpu: number;
  };
}

// ---- reactive config snapshot (seeded + pushed from the backend) ----
const [store, setStore] = createSignal<StoreShape | null>(null);
export { store };

// ---- IPC bridge (wired in the renderer's start()) ----
type Ipc = RendererContext<{ enabled: boolean }>['ipc'];
let ipc: Ipc | null = null;
export const setIpc = (value: Ipc) => {
  ipc = value;
};

export const bridge = {
  loadStore: () => ipc!.invoke('ytmd-sui:load-store') as Promise<StoreShape>,
  /** Resolves false when the write was refused (e.g. theme consent denied). */
  optionSet: (key: string, value: unknown) =>
    ipc!.invoke('ytmd-sui:option-set', key, value) as Promise<boolean>,
  /** Resolves false when the user declined the downgrade warning. */
  setUpdateChannel: (channel: UpdateChannel) =>
    ipc!.invoke('ytmd-sui:update-channel-set', channel) as Promise<boolean>,
  pluginToggle: (id: string, enabled: boolean) =>
    ipc!.invoke('ytmd-sui:plugin-toggle', id, enabled),
  // Plugin field writes ride the app's existing per-plugin config channel.
  pluginSet: (id: string, partial: object) =>
    ipc!.invoke('peard:set-config', id, partial),
  restartSessionOpen: () => ipc!.invoke('ytmd-sui:restart-session-open'),
  restartSessionClose: (changes: RestartRequirement[]) =>
    ipc!.invoke('ytmd-sui:restart-session-close', changes),
  pickPath: (options: object) =>
    ipc!.invoke('ytmd-sui:pick-path', options) as Promise<string | undefined>,
  configEdit: () => ipc!.invoke('ytmd-sui:config-edit'),
  toggleDevTools: () => ipc!.invoke('ytmd-sui:toggle-devtools'),
  restart: () => ipc!.invoke('ytmd-sui:restart'),
  appMeta: () => ipc!.invoke('ytmd-sui:app-meta') as Promise<AppMeta>,
  openExternal: (url: string) => ipc!.invoke('ytmd-sui:open-external', url),
  checkUpdates: () => ipc!.invoke('ytmd-sui:check-updates'),
  themes: () => ipc!.invoke('ytmd-sui:themes') as Promise<ThemeState>,
  setThemeColor: (themeId: string, key: string, value: string) =>
    ipc!.invoke('ytmd-sui:theme-color-set', themeId, key, value),
  setThemePreset: (themeId: string, preset: string) =>
    ipc!.invoke('ytmd-sui:theme-preset-set', themeId, preset),
  resetThemeColors: (themeId: string) =>
    ipc!.invoke('ytmd-sui:theme-colors-reset', themeId),
  importThemeCss: (paths: string[]) =>
    ipc!.invoke('ytmd-sui:import-theme-css', paths),
  openThemesFolder: () => ipc!.invoke('ytmd-sui:open-themes-folder'),
  /** YouTube's UI language as an app language, or undefined when we dont ship it. */
  languageFromYouTube: () =>
    ipc!.invoke('ytmd-sui:language-from-youtube') as Promise<
      string | undefined
    >,
  languageToYouTube: () => ipc!.invoke('ytmd-sui:language-to-youtube'),
};

export const refreshStore = async () => {
  setStore(await bridge.loadStore());
};

const onStorePush = (next: StoreShape) => setStore(next);

export const listenStorePush = () => {
  ipc!.on('ytmd-sui:store-changed', onStorePush);
};

export const unlistenStorePush = () => {
  ipc?.off('ytmd-sui:store-changed', onStorePush);
};

// ---- theme list (loaded at start, refreshed when the backend says so) ----
const [themes, setThemes] = createSignal<ThemeState>();

export const refreshThemes = async () => {
  try {
    setThemes(await bridge.themes());
  } catch {
    // Keep the list we have; the modal then just shows no palette.
  }
};

const onThemesPush = () => {
  refreshThemes();
};

export const listenThemesPush = () => {
  ipc!.on('peard:themes-changed', onThemesPush);
};

export const unlistenThemesPush = () => {
  ipc?.off('peard:themes-changed', onThemesPush);
};

/** The selected theme, or undefined while nothing is selected or loaded. */
export const selectedTheme = (): PearTheme | undefined => {
  const id = store()?.options.theme ?? '';
  return themes()?.themes.find((theme) => theme.id === id);
};

/** Custom palettes the user edited, keyed by theme id. */
export const themeOverrides = (): Record<string, ThemePalette> =>
  (store()?.options.themeOverrides as Record<string, ThemePalette>) ?? {};

/**
 * Preset picked per theme id: a preset name, `custom`, or '' for Default. A
 * theme the user never chose for has no entry at all, which is what lets a
 * palette-less theme fall to its first preset.
 */
export const themePresetNames = (): Record<string, string> =>
  (store()?.options.themePresets as Record<string, string>) ?? {};

/** Presets the selected theme offers; empty when it has none. */
export const themePresets = (): ThemePresets => selectedTheme()?.presets ?? {};

/**
 * The selected theme's preset pick: a preset name, `custom`, or ''. A theme
 * with no palette declared resolves to its first preset.
 */
export const themePreset = (): string => {
  const theme = selectedTheme();
  if (!theme) return '';

  return (
    defaultPreset(theme.palette, theme.presets, themePresetNames()[theme.id]) ??
    ''
  );
};

/**
 * The preset picker's options, in order: Default when the theme has a palette,
 * its presets, then the palette the user edited.
 */
export const themePresetOptions = (): string[] => {
  const theme = selectedTheme();
  if (!theme) return [];

  return [
    ...(theme.palette ? [''] : []),
    ...Object.keys(theme.presets ?? {}),
    CUSTOM_PRESET,
  ];
};

/** Palette of the selected theme after its preset or custom layer. */
export const themePalette = (): ThemePalette => {
  const theme = selectedTheme();
  if (!theme) return {};

  return resolvePalette(
    theme.palette,
    presetPalette(
      theme.palette,
      theme.presets,
      themePresetNames()[theme.id],
      themeOverrides()[theme.id] ?? {},
    ),
  );
};

// ---- widget sizes ----
/** Remembered for the session: closing the modal unmounts all of it. */
export interface SettingsLayout {
  width?: number;
  height?: number;
  sidebarWidth?: number;
}

const [layout, setLayout] = createSignal<SettingsLayout>({});
export { layout };

export const patchLayout = (patch: SettingsLayout) =>
  setLayout((current) => ({ ...current, ...patch }));

// ---- value helpers ----

/** Optimistically patch a dotted path in the local store signal. */
export const patchLocal = (path: string, value: unknown) => {
  const current = store();
  if (!current) return;
  setStore(setByPath(structuredClone(current), path, value));
};

// Arrays are replaced, matching how the backend merges a plugin's stored
// config over its defaults.
const deepmerge = deepmergeCustom({ mergeArrays: false });

// ---- app option get/set (with the tray composite special case) ----

const TRAY_KEY = 'options.__trayMode';
const UPDATE_CHANNEL_KEY = 'options.updateChannel';

export const getAppValue = (snapshot: StoreShape, key: string): unknown => {
  if (key === TRAY_KEY) {
    if (!snapshot.options.tray) return 'off';
    return snapshot.options.appVisible ? 'show' : 'hide';
  }
  return getByPath(snapshot, key);
};

export const setAppValue = async (key: string, value: unknown) => {
  if (key === TRAY_KEY) {
    const tray = value !== 'off';
    const appVisible = value !== 'hide';
    patchLocal('options.tray', tray);
    patchLocal('options.appVisible', appVisible);
    if (
      (
        await Promise.all([
          bridge.optionSet('options.tray', tray),
          bridge.optionSet('options.appVisible', appVisible),
        ])
      ).includes(false)
    ) {
      await refreshStore();
    }
    return;
  }

  // The channel switch can be refused (a declined downgrade warning), so it
  // goes through its own channel instead of the generic option write.
  if (key === UPDATE_CHANNEL_KEY) {
    patchLocal(key, value);
    if ((await bridge.setUpdateChannel(value as UpdateChannel)) === false) {
      await refreshStore();
    }
    return;
  }

  patchLocal(key, value);
  // A refused write leaves the optimistic patch in place, so re-read.
  if ((await bridge.optionSet(key, value)) === false) await refreshStore();
};

// ---- plugin config get/set ----

export const getPluginConfig = (
  snapshot: StoreShape,
  id: string,
  defaults: Record<string, unknown>,
): Record<string, unknown> => {
  const stored = (snapshot.plugins as PluginConfigMap)[id];
  return deepmerge(defaults, stored ?? {}) as Record<string, unknown>;
};

export const setPluginValue = (id: string, key: string, value: unknown) => {
  patchLocal(`plugins.${id}.${key}`, value);
  bridge.pluginSet(id, nestPartial(key, value));
};

/**
 * Slider drags fire on every pixel, and each write goes through IPC to disk, so
 * one write per burst is enough. The last value of the burst wins; a flush
 * (closing the modal, restarting) writes whatever is still pending.
 */
const PLUGIN_SLIDER_DEBOUNCE_MS = 200;
const pendingPluginWrites = new Map<
  string,
  { timeout: ReturnType<typeof setTimeout>; write: () => Promise<unknown> }
>();

export const setPluginSliderValue = (
  id: string,
  key: string,
  value: unknown,
) => {
  patchLocal(`plugins.${id}.${key}`, value);

  const writeKey = `${id}:${key}`;
  clearTimeout(pendingPluginWrites.get(writeKey)?.timeout);

  const write = () => bridge.pluginSet(id, nestPartial(key, value));
  pendingPluginWrites.set(writeKey, {
    timeout: setTimeout(() => {
      pendingPluginWrites.delete(writeKey);
      write();
    }, PLUGIN_SLIDER_DEBOUNCE_MS),
    write,
  });
};

/** Persist the slider values still waiting for their debounce timer. */
export const flushPendingPluginSliderWrites = async () => {
  const pending = [...pendingPluginWrites.values()];
  pendingPluginWrites.clear();

  for (const { timeout } of pending) clearTimeout(timeout);
  await Promise.all(pending.map(({ write }) => write()));
};

// ---- native dialog helpers (for `action` fields) ----

export const pickDirectory = (): Promise<string | undefined> =>
  bridge.pickPath({ properties: ['openDirectory', 'createDirectory'] });

export const pickFile = (
  filters?: { name: string; extensions: string[] }[],
): Promise<string | undefined> =>
  bridge.pickPath({ properties: ['openFile'], filters });
