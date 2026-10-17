import { expect, test } from '@playwright/test';
import { Window } from 'happy-dom';

import { installAnimationThrottle } from '../src/providers/performance-mode-animations';

type AnimateCall = { keyframes: unknown; options?: unknown };
type AnimatableElement = {
  animate: (keyframes: unknown, options?: unknown) => unknown;
};

const withHappyDomElement = (
  run: (element: AnimatableElement, calls: AnimateCall[]) => void,
) => {
  const window = new Window();
  const ElementCtor = window.Element as unknown as typeof globalThis.Element;
  const proto = ElementCtor.prototype as unknown as {
    animate?: (keyframes: unknown, options?: unknown) => unknown;
  };
  const calls: AnimateCall[] = [];

  proto.animate = (keyframes, options) => {
    calls.push({ keyframes, options });
    return {};
  };

  const previous = globalThis.Element;
  globalThis.Element = ElementCtor;

  try {
    run(
      window.document.createElement('div') as unknown as AnimatableElement,
      calls,
    );
  } finally {
    globalThis.Element = previous;
  }
};

test('collapses animations that touch non-composited properties', () => {
  withHappyDomElement((element, calls) => {
    installAnimationThrottle();

    element.animate([{ visibility: 'hidden' }], {
      duration: 200,
      iterations: 1,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].options).toMatchObject({
      duration: 0,
      fill: 'forwards',
      iterations: 1,
    });
  });
});

test('leaves composited animations alone', () => {
  withHappyDomElement((element, calls) => {
    installAnimationThrottle();

    element.animate([{ opacity: 0, transform: 'scale(0.9)' }], 200);

    expect(calls).toHaveLength(1);
    expect(calls[0].options).toBe(200);
  });
});

test('installing twice does not wrap the native method again', () => {
  withHappyDomElement((element, calls) => {
    installAnimationThrottle();
    installAnimationThrottle();

    element.animate([{ height: '10px' }], 300);

    expect(calls).toHaveLength(1);
    expect(calls[0].options).toMatchObject({ duration: 0 });
  });
});
