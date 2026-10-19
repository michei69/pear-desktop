import { expect, test } from '@playwright/test';
import { Window } from 'happy-dom';

import { getGuideLists, watchGuides } from '../src/utils/guide';

const useDocument = (window: Window) => {
  globalThis.document = window.document as unknown as Document;
};

/** A guide with the given primary entries, mounted on the page. */
const guide = (window: Window, id: string, labels: string[]) => {
  const element = window.document.createElement('ytmusic-guide-renderer');
  element.id = id;

  const section = window.document.createElement(
    'ytmusic-guide-section-renderer',
  );
  section.setAttribute('is-primary', '');

  const items = window.document.createElement('div');
  items.id = 'items';
  for (const label of labels) {
    const entry = window.document.createElement('ytmusic-guide-entry-renderer');
    entry.textContent = label;
    items.append(entry);
  }
  section.append(items);
  element.append(section);
  window.document.body.append(element);

  return { element, items };
};

test('finds both guides YTM keeps mounted at the same time', () => {
  const window = new Window();
  useDocument(window);
  guide(window, 'guide-renderer', ['Home']);
  guide(window, 'mini-guide-renderer', ['Home']);

  expect(getGuideLists().map(({ guide: element }) => element.id)).toEqual([
    'guide-renderer',
    'mini-guide-renderer',
  ]);
});

/** Records observe() calls so the test can emit mutation batches by hand. */
class FakeObserver {
  static all: FakeObserver[] = [];
  callback: MutationCallback;
  target: Node | null = null;
  init: MutationObserverInit | null = null;

  constructor(callback: MutationCallback) {
    this.callback = callback;
    FakeObserver.all.push(this);
  }

  observe(target: Node, init: MutationObserverInit) {
    this.target = target;
    this.init = init;
  }

  disconnect() {
    this.target = null;
  }

  emit() {
    if (this.target) this.callback([], this as unknown as MutationObserver);
  }
}

test('keeps watching for guides created after the first sync', () => {
  const window = new Window();
  useDocument(window);

  const previous = {
    MutationObserver: globalThis.MutationObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  const frames: FrameRequestCallback[] = [];
  const flushFrames = () => {
    for (const frame of frames.splice(0)) frame(0);
  };

  FakeObserver.all = [];
  globalThis.MutationObserver =
    FakeObserver as unknown as typeof MutationObserver;
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    frames.push(callback)) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;

  try {
    let syncs = 0;
    const stop = watchGuides(() => syncs++);

    expect(syncs).toBe(1);
    const observer = FakeObserver.all[0];
    expect(observer.target).toBe(window.document.documentElement);
    expect(observer.init).toEqual({ childList: true, subtree: true });

    // Mutations are coalesced into one sync per frame, not disconnected after
    // the first guide is found.
    observer.emit();
    observer.emit();
    expect(syncs).toBe(1);
    expect(frames).toHaveLength(1);
    flushFrames();
    expect(syncs).toBe(2);

    observer.emit();
    flushFrames();
    expect(syncs).toBe(3);

    stop();
    expect(observer.target).toBeNull();
    observer.emit();
    flushFrames();
    expect(syncs).toBe(3);
  } finally {
    Object.assign(globalThis, previous);
  }
});
