// Performance mode: cheaper YTM feature flags, no animations or backdrop
// blur, and the page halves of the visual plugins left unstarted. Opt-in and
// restart-only (advanced.performanceMode), so the page decides once at boot.

import type { Flags } from "@pear/sdk/core-config";

/**
 * Flags forced while performance mode is on. The page's own
 * `EXPERIMENT_FLAGS` read them; a flag the user overrides wins (see
 * `performanceModeOverrides`).
 */
export const performanceModeFeatureFlags: Flags = {
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

/** Performance mode flags first, the user's own flag overrides second, so a deliberate choice always wins. */
export function performanceModeOverrides(userOverrides: Flags, enabled: boolean): Flags {
  return enabled ? { ...performanceModeFeatureFlags, ...userOverrides } : userOverrides;
}

/** Plugins whose whole purpose is expensive visuals; their page half is not started in performance mode. */
const SKIPPED_PLUGINS: Record<string, true> = {
  "ambient-mode": true,
  "blur-nav-bar": true,
  visualizer: true,
};

export function isSkippedInPerformanceMode(id: string, performanceMode: boolean) {
  return performanceMode && SKIPPED_PLUGINS[id] === true;
}

/**
 * Stops per-frame compositing work: animations, transitions, backdrop blurs and
 * the layer hints the page leaves on animated elements. Applied with
 * `!important`, so it also beats the page's inline styles.
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

/** Properties Blink cannot composite; animations touching them cost a main-thread frame each. */
const LAYOUT_PROPERTIES: Record<string, true> = {
  left: true,
  right: true,
  top: true,
  bottom: true,
  width: true,
  height: true,
  "min-width": true,
  "max-width": true,
  "min-height": true,
  "max-height": true,
  margin: true,
  "margin-left": true,
  "margin-right": true,
  "margin-top": true,
  "margin-bottom": true,
  padding: true,
  "padding-left": true,
  "padding-right": true,
  "padding-top": true,
  "padding-bottom": true,
  visibility: true,
  "scrollbar-color": true,
  "scrollbar-width": true,
  "background-color": true,
  color: true,
  "border-color": true,
  "box-shadow": true,
  "text-shadow": true,
  "border-radius": true,
  outline: true,
  "outline-offset": true,
  "clip-path": true,
  "transform-origin": true,
  "font-size": true,
  "line-height": true,
  "letter-spacing": true,
  "flex-basis": true,
  gap: true,
  "row-gap": true,
  "column-gap": true,
};

/**
 * Collapses Web Animations that touch properties Blink cannot composite. YTM
 * runs many of them per minute through `Element.animate`; shrinking their
 * duration keeps the end state (`fill: forwards`) and resolves `finished` at
 * once, so code waiting on the animation still proceeds.
 */
export function installAnimationThrottle() {
  const nativeAnimate = Element.prototype.animate;
  // Nothing to patch, or a previous runtime injection already did.
  if (typeof nativeAnimate !== "function" || "__pearAnimationThrottle" in nativeAnimate) return;

  const touchesLayout = (keyframes: Keyframe[] | PropertyIndexedKeyframes | null) => {
    if (!keyframes || typeof keyframes !== "object") return false;
    for (const frame of Array.isArray(keyframes) ? keyframes : [keyframes]) {
      if (!frame || typeof frame !== "object") continue;
      for (const key of Object.keys(frame)) if (LAYOUT_PROPERTIES[key] === true) return true;
    }
    return false;
  };

  const throttled = function (
    this: Element,
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ) {
    if (!touchesLayout(keyframes)) return nativeAnimate.call(this, keyframes, options);
    const timing: KeyframeAnimationOptions = typeof options === "number" ? { duration: 0 } : { ...(options ?? {}), duration: 0 };
    if (timing.fill === undefined) timing.fill = "forwards";
    return nativeAnimate.call(this, keyframes, timing);
  };

  Object.defineProperty(throttled, "__pearAnimationThrottle", { value: true });
  Element.prototype.animate = throttled as typeof Element.prototype.animate;
}
