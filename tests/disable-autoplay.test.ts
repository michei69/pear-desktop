import { expect, test } from '@playwright/test';
import { Window } from 'happy-dom';

import disableAutoplay from '../src/plugins/disable-autoplay';

import type { MusicPlayer } from '../src/types/music-player';

const withDom = (run: (window: Window) => void) => {
  const window = new Window();
  const previous = {
    window: (globalThis as Record<string, unknown>).window,
    document: (globalThis as Record<string, unknown>).document,
    HTMLVideoElement: (globalThis as Record<string, unknown>).HTMLVideoElement,
  };
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLVideoElement: window.HTMLVideoElement,
  });

  try {
    run(window);
  } finally {
    Object.assign(globalThis, previous);
    window.happyDOM.close();
  }
};

const makeContext = () => {
  let pauses = 0;
  const context = {
    ...disableAutoplay.renderer,
    config: { enabled: true, applyOnce: true },
    api: {
      pauseVideo: () => {
        pauses += 1;
      },
    } as unknown as MusicPlayer,
  };
  // `startPlugin` binds every renderer method to the renderer object, so a
  // method that removes itself (`this.eventListener`) finds the registered
  // listener. Mirror that here.
  for (const [key, value] of Object.entries(context)) {
    if (typeof value === 'function') {
      (context as unknown as Record<string, unknown>)[key] =
        value.bind(context);
    }
  }
  return { context, pauses: () => pauses };
};

const videoData = (window: Window, name: string) =>
  new window.CustomEvent('videodatachange', { detail: { name } });

test('a non-dataloaded event does not consume the one-shot', () =>
  withDom((window) => {
    const { context, pauses } = makeContext();
    window.document.addEventListener('videodatachange', context.eventListener);

    window.document.dispatchEvent(videoData(window, 'newdata'));
    expect(pauses()).toBe(0);

    window.document.dispatchEvent(videoData(window, 'dataloaded'));
    expect(pauses()).toBe(1);

    // The one-shot is spent: a later track must not pause again.
    window.document.dispatchEvent(videoData(window, 'dataloaded'));
    expect(pauses()).toBe(1);
  }));

test('turning apply-once off re-arms a consumed listener', () =>
  withDom((window) => {
    const { context, pauses } = makeContext();
    window.document.addEventListener('videodatachange', context.eventListener);
    window.document.dispatchEvent(videoData(window, 'dataloaded'));
    expect(pauses()).toBe(1);

    context.onConfigChange({
      enabled: true,
      applyOnce: false,
    });

    window.document.dispatchEvent(videoData(window, 'dataloaded'));
    window.document.dispatchEvent(videoData(window, 'dataloaded'));
    expect(pauses()).toBe(3);
  }));

test('the armed timeupdate pauses the element once', () =>
  withDom((window) => {
    const video = window.document.createElement('video');
    let videoPauses = 0;
    video.pause = () => {
      videoPauses += 1;
    };
    window.document.body.append(video);

    const { context } = makeContext();
    window.document.addEventListener('videodatachange', context.eventListener);
    window.document.dispatchEvent(videoData(window, 'dataloaded'));

    video.dispatchEvent(new window.Event('timeupdate'));
    expect(videoPauses).toBe(1);

    // `once: true`: a second tick must not pause again.
    video.dispatchEvent(new window.Event('timeupdate'));
    expect(videoPauses).toBe(1);
  }));
