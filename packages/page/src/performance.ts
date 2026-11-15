// Performance switches: cheaper YTM feature flags, no animations or backdrop
// blur, and the page halves of the visual plugins left unstarted. Each part is
// restart-only (performance.*), so the page decides once at boot.

import { performanceModeFeatureFlags, performanceModeOverrides } from "@pear/sdk/core-config";

// The flags live in the shared config module: the main process reports what the
// app sets through the API server, with the same merge the page applies.
export { performanceModeFeatureFlags, performanceModeOverrides };

/** Plugins whose whole purpose is expensive visuals; their page half is not started while the plugins switch is on. */
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

/**
 * YTM may serve a Trusted Types CSP, which turns plugin DOM writes through
 * innerHTML/insertAdjacentHTML into exceptions. A pass-through `default`
 * policy keeps them working, like pear-desktop's renderer registers at boot.
 *
 * The page runtime calls this at boot (from packages/page/src/index.ts),
 * before it builds the player or starts plugins, so the policy is in place
 * before any plugin DOM write.
 */
interface TrustedTypesFactory {
  createPolicy(
    name: string,
    rules: { createHTML(input: string): string; createScript(input: string): string; createScriptURL(input: string): string },
  ): unknown;
}

export function installTrustedTypesPolicy(
  factory = (globalThis as unknown as { trustedTypes?: TrustedTypesFactory }).trustedTypes,
): boolean {
  if (!factory?.createPolicy) return false;
  try {
    factory.createPolicy("default", {
      createHTML: (input) => input,
      createScript: (input) => input,
      createScriptURL: (input) => input,
    });
    return true;
  } catch {
    // Another runtime already registered a `default` policy.
    return false;
  }
}
