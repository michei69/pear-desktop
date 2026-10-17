import type { FeatureFlagOverrides } from '@/plugins/settings-ui/injectors/flags';

type PerformancePart = 'flags' | 'css' | 'plugins';

/**
 * Debug escape hatch: `PEAR_PERF_DISABLE=flags,css` keeps performance mode on
 * but turns individual parts off, to bisect which one costs what. The renderer
 * has no `process`, so preload forwards the value through the bridge.
 */
const disabledParts = () => {
  if (typeof process !== 'undefined' && process.env) {
    return process.env.PEAR_PERF_DISABLE ?? '';
  }

  return (
    (globalThis as { pearPerfDisabledParts?: string }).pearPerfDisabledParts ??
    ''
  );
};

export const isPerformancePartEnabled = (part: PerformancePart) =>
  !disabledParts()
    .split(',')
    .map((value) => value.trim())
    .includes(part);

/**
 * YouTube Music flags forced while performance mode is on. Values are read by
 * the page's own `EXPERIMENT_FLAGS`; a flag the user overrides wins (see
 * `performanceModeOverrides`).
 */
export const performanceModeFeatureFlags: FeatureFlagOverrides = {
  // Artwork: fixed 1x thumbnail factor instead of the device pixel ratio, no
  // forced max quality, no placeholder background, no oversized search art.
  kevlar_tuner_should_use_thumbnail_factor: true,
  kevlar_tuner_thumbnail_factor: 1,
  kevlar_tuner_max_thumbnail_quality: false,
  kevlar_thumbnail_bg: false,
  enable_desktop_search_bigger_thumbs: false,
  yt_img_shadow_trigger_show_on_visible: true,
  // Motion: Lottie/Rive/WASM animations and the watch-page cinematics are the
  // expensive half of the UI; they are all optional.
  web_animated_actions: false,
  web_animated_actions_v2: false,
  web_enable_voting_animation: false,
  enable_music_web_cairo_voting_animation: false,
  enable_player_bar_slide_up_animation: false,
  web_enable_rive_animated_like_icon: false,
  music_web_enable_album_art_zoom: false,
  web_watch_cinematics_disabled_by_default: true,
  web_watch_cinematics_preferred_reduced_motion_default_disabled: true,
  // Cheaper list and icon rendering.
  music_web_optimize_queue_rendering: true,
  wil_icon_render_when_idle: true,
  always_render_thumbnail_overlay: false,
  web_enable_card_view_model_hover_effect: false,
};

/**
 * Performance mode flags first, the user's own flag overrides second, so a
 * deliberate choice always wins.
 */
export const performanceModeOverrides = (
  userOverrides: FeatureFlagOverrides,
  enabled: boolean,
): FeatureFlagOverrides =>
  enabled
    ? { ...performanceModeFeatureFlags, ...userOverrides }
    : userOverrides;

/**
 * Plugins whose whole purpose is expensive visuals. Their renderer half is not
 * started in performance mode; their config is left untouched, so turning the
 * mode off brings them back.
 */
const PERFORMANCE_MODE_SKIPPED_PLUGINS = new Set([
  'ambient-mode',
  'blur-nav-bar',
  'visualizer',
]);

export const isSkippedInPerformanceMode = (id: string, enabled: boolean) =>
  enabled &&
  isPerformancePartEnabled('plugins') &&
  PERFORMANCE_MODE_SKIPPED_PLUGINS.has(id);

/**
 * Stops per-frame compositing work: animations, transitions, backdrop blurs and
 * the layer hints the page leaves on animated elements. Injected as a stylesheet
 * with `!important`, so it also beats the page's inline styles.
 */
export const performanceModeCss = `
*,
*::before,
*::after {
  animation-duration: 1ms !important;
  animation-delay: 0s !important;
  animation-iteration-count: 1 !important;
  transition-duration: 1ms !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  will-change: auto !important;
}

:root {
  --yt-frosted-glass-backdrop-filter-override: none !important;
}

.ytp-image-background {
  filter: none !important;
}
`;
