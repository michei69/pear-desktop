import { t } from '@/i18n';

const CATEGORY_IDS = [
  'playback',
  'audio',
  'interface',
  'lyrics',
  'integrations',
  'system',
  'other',
] as const;

export type PluginCategoryId = (typeof CATEGORY_IDS)[number];

const CATEGORY_BY_PLUGIN: Record<string, PluginCategoryId> = {
  'playback-speed': 'playback',
  'playback-recovery': 'playback',
  'crossfade': 'playback',
  'disable-autoplay': 'playback',
  'skip-silences': 'playback',
  'sponsorblock': 'playback',
  'seek-shortcuts': 'playback',
  'prefer-song': 'playback',
  'skip-ai-slop': 'playback',
  'quality-changer': 'playback',
  'video-toggle': 'playback',
  'picture-in-picture': 'playback',
  'captions-selector': 'playback',
  'sfw-music': 'playback',

  'equalizer': 'audio',
  'audio-compressor': 'audio',
  'audio-only': 'audio',
  'audio-track': 'audio',
  'custom-output-device': 'audio',
  'precise-volume': 'audio',
  'exponential-volume': 'audio',
  'always-show-volume-slider': 'audio',

  'album-actions': 'interface',
  'album-color-theme': 'interface',
  'ambient-mode': 'interface',
  'blur-nav-bar': 'interface',
  'clock': 'interface',
  'dismiss-multidevice-popup': 'interface',
  'fullscreen-auto-hide': 'interface',
  'in-app-menu': 'interface',
  'navigation': 'interface',
  'playlist-search': 'interface',
  'search-commands': 'interface',
  'shortcuts': 'interface',
  'toast-autoclose': 'interface',
  'transparent-player': 'interface',
  'unobtrusive-player': 'interface',
  'visualizer': 'interface',
  'no-google-login': 'interface',

  'synced-lyrics': 'lyrics',
  'statusbar-lyrics': 'lyrics',

  'api-server': 'integrations',
  'discord': 'integrations',
  'downloader': 'integrations',
  'lumiastream': 'integrations',
  'music-together': 'integrations',
  'scrobbler': 'integrations',
  'tuna-obs': 'integrations',
  'amuse': 'integrations',

  'auth-proxy-adapter': 'system',
  'do-not-track': 'system',
  'memory-saver': 'system',
  'notifications': 'system',
  'performance-improvement': 'system',
  'settings-ui': 'system',
  'taskbar-mediacontrol': 'system',
  'touchbar': 'system',
};

export const pluginCategoryId = (id: string): PluginCategoryId =>
  CATEGORY_BY_PLUGIN[id] ?? 'other';

export const pluginCategoryLabel = (id: PluginCategoryId) =>
  t(`settings-ui.plugin-categories.${id}`);

export const groupPluginsByCategory = <T extends { id: string; name: string }>(
  plugins: T[],
): { id: PluginCategoryId; label: () => string; plugins: T[] }[] =>
  CATEGORY_IDS.map((id) => ({
    id,
    label: () => pluginCategoryLabel(id),
    plugins: plugins
      .filter((plugin) => pluginCategoryId(plugin.id) === id)
      .sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((group) => group.plugins.length > 0);
