/**
 * Collapses Web Animations that touch properties Blink cannot composite.
 *
 * YTM animates `visibility`, `scrollbar-color`, `left` and `height` through
 * `Element.animate`, which Blink services on the main thread every frame. The
 * trace showed ~120 of them running per minute. Shrinking their duration keeps
 * the end state (`fill: forwards`) and resolves `finished` at once, so code
 * waiting on the animation still proceeds.
 *
 * Injected as source through `executeJavaScript`, so it must stay
 * self-contained and close over nothing.
 */
export function installAnimationThrottle() {
  const ElementCtor = globalThis.Element;
  // oxlint-disable-next-line typescript/unbound-method -- always invoked with .call(this)
  const nativeAnimate = ElementCtor?.prototype.animate;
  if (typeof nativeAnimate !== 'function') return;
  if ('__pearAnimationThrottle' in nativeAnimate) return;

  const layoutProperties = new Set([
    'left',
    'right',
    'top',
    'bottom',
    'width',
    'height',
    'min-width',
    'max-width',
    'min-height',
    'max-height',
    'margin',
    'margin-left',
    'margin-right',
    'margin-top',
    'margin-bottom',
    'padding',
    'padding-left',
    'padding-right',
    'padding-top',
    'padding-bottom',
    'visibility',
    'scrollbar-color',
    'scrollbar-width',
    'background-color',
    'color',
    'border-color',
    'box-shadow',
    'text-shadow',
    'border-radius',
    'outline',
    'outline-offset',
    'clip-path',
    'transform-origin',
    'font-size',
    'line-height',
    'letter-spacing',
    'flex-basis',
    'gap',
    'row-gap',
    'column-gap',
  ]);

  const touchesLayout = (keyframes: unknown) => {
    if (!keyframes || typeof keyframes !== 'object') return false;

    const frames = Array.isArray(keyframes) ? keyframes : [keyframes];
    for (const frame of frames) {
      if (!frame || typeof frame !== 'object') continue;
      for (const key of Object.keys(frame)) {
        if (layoutProperties.has(key)) return true;
      }
    }

    return false;
  };

  const throttled = function (
    this: Element,
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ) {
    if (!touchesLayout(keyframes)) {
      return nativeAnimate.call(this, keyframes, options);
    }

    const timing =
      typeof options === 'number'
        ? { duration: 0 }
        : { ...(options ?? {}), duration: 0 };
    if (timing.fill === undefined) timing.fill = 'forwards';

    return nativeAnimate.call(this, keyframes, timing);
  };

  Object.defineProperty(throttled, '__pearAnimationThrottle', { value: true });
  ElementCtor.prototype.animate =
    throttled as typeof ElementCtor.prototype.animate;
}
