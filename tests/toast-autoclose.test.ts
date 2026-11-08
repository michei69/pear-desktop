import { expect, test } from '@playwright/test';
import { Window } from 'happy-dom';

import toastAutoClose from '../src/plugins/toast-autoclose/index';

type Toast = HTMLElement & { close?: () => void };

type RenderedToast = { toast: Toast; closed: () => boolean };

/** Replaces a global for one test and puts the previous descriptor back. */
const replaceGlobal = (
  name: string,
  value: unknown,
  saved: Record<string, PropertyDescriptor | undefined>,
) => {
  saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
};

/** A page with YTM's app root and a way to add reusable paper toasts. */
const page = () => {
  const window = new Window({ url: 'https://music.youtube.com/' });
  const savedGlobals: Record<string, PropertyDescriptor | undefined> = {};
  const setGlobal = (name: string, value: unknown) =>
    replaceGlobal(name, value, savedGlobals);

  setGlobal('window', window);
  setGlobal('document', window.document);
  setGlobal('Element', window.Element);
  setGlobal('HTMLElement', window.HTMLElement);
  setGlobal('MutationObserver', window.MutationObserver);
  setGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 0),
  );
  setGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));

  const restoreGlobals = () => {
    for (const [name, descriptor] of Object.entries(savedGlobals)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as unknown as Record<string, unknown>)[name];
    }
  };

  const root = document.createElement('ytmusic-app');
  document.body.append(root);

  const addToast = (): RenderedToast => {
    const toast = document.createElement('tp-yt-paper-toast') as Toast;
    toast.className = 'paper-toast-open';
    const closeButton = document.createElement('button');
    closeButton.id = 'close-button';
    const button = document.createElement('button');
    closeButton.append(button);
    let closed = false;
    button.addEventListener('click', () => {
      closed = true;
    });
    toast.append(closeButton);
    root.append(toast);
    return { toast, closed: () => closed };
  };

  return { window, addToast, restoreGlobals };
};

/** Captures the timers the plugin arms, so a 3 s deadline is checked instantly. */
const captureTimers = () => {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const scheduled = new Map<number, () => void>();
  let nextId = 0;

  globalThis.setTimeout = ((callback: () => void) => {
    scheduled.set(++nextId, callback);
    return nextId;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => {
    scheduled.delete(id);
  }) as unknown as typeof clearTimeout;

  return {
    scheduled,
    restore: () => {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    },
  };
};

const startPlugin = () => {
  const renderer = toastAutoClose.renderer;
  if (!renderer || typeof renderer === 'function')
    throw new Error('no renderer');

  renderer.start?.call(renderer);
  return renderer;
};

/** Lets the MutationObserver callback and the coalesced rAF scan run. */
const waitForScan = (window: Window) =>
  new Promise((resolve) => window.setTimeout(resolve, 30));

test('a toast that closes and reopens before a scan gets a fresh deadline', async () => {
  const { window, addToast, restoreGlobals } = page();
  const { toast, closed } = addToast();
  const timers = captureTimers();
  const renderer = startPlugin();

  try {
    expect(timers.scheduled.size).toBe(1);
    const [firstTimer] = timers.scheduled.keys();

    // YTM re-shows a message on the same element: close + open in one task,
    // so both class changes are coalesced into a single scan.
    toast.classList.remove('paper-toast-open');
    toast.classList.add('paper-toast-open');
    await waitForScan(window);

    // The old deadline is cancelled and the new message re-armed.
    expect(timers.scheduled.has(firstTimer)).toBe(false);
    expect(timers.scheduled.size).toBe(1);

    const [newTimer] = timers.scheduled.keys();
    timers.scheduled.get(newTimer)?.();
    expect(closed()).toBe(true);
  } finally {
    renderer.stop?.call(renderer);
    timers.restore();
    restoreGlobals();
    await window.happyDOM.close();
  }
});

test('a second toast does not extend the first one deadline', async () => {
  const { window, addToast, restoreGlobals } = page();
  const first = addToast();
  const timers = captureTimers();
  const renderer = startPlugin();

  try {
    expect(timers.scheduled.size).toBe(1);
    const [firstTimer] = timers.scheduled.keys();

    const second = addToast();
    await waitForScan(window);

    // The new toast arms its own timer; the first keeps its original deadline.
    expect(timers.scheduled.size).toBe(2);
    expect(timers.scheduled.has(firstTimer)).toBe(true);

    timers.scheduled.get(firstTimer)?.();
    expect(first.closed()).toBe(true);
    expect(second.closed()).toBe(false);
  } finally {
    renderer.stop?.call(renderer);
    timers.restore();
    restoreGlobals();
    await window.happyDOM.close();
  }
});

test('an unrelated class change on an open toast keeps its deadline', async () => {
  const { window, addToast, restoreGlobals } = page();
  const { toast } = addToast();
  const timers = captureTimers();
  const renderer = startPlugin();

  try {
    expect(timers.scheduled.size).toBe(1);
    const [firstTimer] = timers.scheduled.keys();

    toast.classList.add('some-other-class');
    await waitForScan(window);

    expect(timers.scheduled.size).toBe(1);
    expect(timers.scheduled.has(firstTimer)).toBe(true);
  } finally {
    renderer.stop?.call(renderer);
    timers.restore();
    restoreGlobals();
    await window.happyDOM.close();
  }
});
