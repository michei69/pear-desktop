import { expect, test } from '@playwright/test';
import { Window } from 'happy-dom';

import { observePlayerPage } from '../src/providers/player-page-observer';

const observers: FakeObserver[] = [];

/** Records the observe() config so the test can emit batches by hand. */
class FakeObserver {
  target: Element | null = null;
  init: MutationObserverInit | null = null;
  callback: MutationCallback;

  constructor(callback: MutationCallback) {
    this.callback = callback;
    observers.push(this);
  }

  observe(target: Element, init: MutationObserverInit) {
    this.target = target;
    this.init = init;
  }

  disconnect() {
    this.target = null;
  }

  emit(batch: MutationRecord[]) {
    this.callback(batch, this as unknown as MutationObserver);
  }
}

test('watches on one root share an observer and only see their own mutations', () => {
  const window = new Window();
  const previousDocument = globalThis.document;
  const previousObserver = globalThis.MutationObserver;

  Object.assign(globalThis, { document: window.document });
  globalThis.MutationObserver =
    FakeObserver as unknown as typeof MutationObserver;

  try {
    window.document.body.innerHTML =
      '<ytmusic-player playback-mode="ATV_PREFERRED"><div id="song"></div></ytmusic-player>';
    const player = window.document.querySelector('ytmusic-player')!;
    const song = window.document.querySelector('#song')!;

    const attributeHits: string[] = [];
    const childHits: number[] = [];

    const unwatchAttributes = observePlayerPage('ytmusic-player', {
      attributes: ['playback-mode'],
      callback: (mutations) => {
        for (const entry of mutations) attributeHits.push(entry.attributeName!);
      },
    });
    const unwatchChildren = observePlayerPage('ytmusic-player', {
      childList: true,
      subtree: true,
      callback: () => childHits.push(1),
    });

    // Two watches, one observer, observing the union of what they need.
    expect(observers).toHaveLength(1);
    expect(observers[0].init).toMatchObject({
      attributes: true,
      attributeFilter: ['playback-mode'],
      childList: true,
      subtree: true,
    });

    observers[0].emit([
      {
        type: 'attributes',
        target: player,
        attributeName: 'playback-mode',
      } as unknown as MutationRecord,
    ]);
    expect(attributeHits).toEqual(['playback-mode']);
    expect(childHits).toEqual([]);

    observers[0].emit([
      { type: 'childList', target: player } as unknown as MutationRecord,
    ]);
    expect(attributeHits).toEqual(['playback-mode']);
    expect(childHits).toEqual([1]);

    // A root-only watch never sees a descendant's attributes.
    observers[0].emit([
      {
        type: 'attributes',
        target: song,
        attributeName: 'playback-mode',
      } as unknown as MutationRecord,
    ]);
    expect(attributeHits).toEqual(['playback-mode']);

    unwatchAttributes();
    expect(observers[0].target).toBe(player);

    unwatchChildren();
    expect(observers[0].target).toBeNull();

    // Leaving the last watch releases the root, so the next one starts fresh.
    const unwatchAgain = observePlayerPage('ytmusic-player', {
      attributes: ['playback-mode'],
      callback: () => {},
    });
    expect(observers).toHaveLength(2);
    unwatchAgain();
    expect(observers[1].target).toBeNull();

    // Replacing the node retargets the shared observer instead of dropping the
    // watches other plugins still hold.
    const hits: string[] = [];
    const unwatchFirst = observePlayerPage('ytmusic-player', {
      attributes: ['playback-mode'],
      callback: () => hits.push('first'),
    });
    expect(observers).toHaveLength(3);

    const replacement = window.document.createElement('ytmusic-player');
    player.replaceWith(replacement);
    const unwatchSecond = observePlayerPage('ytmusic-player', {
      attributes: ['playback-mode'],
      callback: () => hits.push('second'),
    });
    expect(observers).toHaveLength(3);
    expect(observers[2].target).toBe(replacement);

    observers[2].emit([
      {
        type: 'attributes',
        target: replacement,
        attributeName: 'playback-mode',
      } as unknown as MutationRecord,
    ]);
    expect(hits).toEqual(['first', 'second']);

    unwatchFirst();
    unwatchSecond();
    expect(observers[2].target).toBeNull();
  } finally {
    window.document.body.innerHTML = '';
    Object.assign(globalThis, { document: previousDocument });
    globalThis.MutationObserver = previousObserver;
  }
});
