import { expect, test } from '@playwright/test';
import { Window } from 'happy-dom';

import {
  onPlayerApiReady,
  onUnload,
} from '../src/plugins/precise-volume/renderer';

import type { MusicPlayer } from '../src/types/music-player';

type Config = {
  enabled: boolean;
  steps: number;
  arrowsShortcut: boolean;
  globalShortcuts: { volumeUp: string; volumeDown: string };
  savedVolume?: number;
};

const withDom = async (run: (window: Window) => Promise<void>) => {
  const window = new Window();
  const previous = {
    window: (globalThis as Record<string, unknown>).window,
    document: (globalThis as Record<string, unknown>).document,
    MutationObserver: (globalThis as Record<string, unknown>).MutationObserver,
  };
  Object.assign(globalThis, {
    window,
    document: window.document,
    MutationObserver: window.MutationObserver,
  });
  (window as unknown as Record<string, unknown>).mainConfig = {
    plugins: { isEnabled: async () => true },
  };

  try {
    await run(window);
  } finally {
    onUnload();
    Object.assign(globalThis, previous);
    window.happyDOM.close();
  }
};

/** A `value`-reflecting element like YTM's `tp-yt-paper-slider`. */
const volumeSlider = (window: Window) => {
  const slider = window.document.createElement('tp-yt-paper-slider');
  slider.id = 'volume-slider';
  Object.defineProperty(slider, 'value', {
    get() {
      return this.getAttribute('value') ?? '';
    },
    set(value: string) {
      this.setAttribute('value', value);
    },
  });
  slider.setAttribute('value', '50');
  window.document.body.append(slider);
  return slider;
};

test('a small manual slider change is persisted', async () => {
  await withDom(async (window) => {
    // `firstRun` only wires the slider observer when the playbar exists.
    window.document.body.append(
      window.document.createElement('ytmusic-player-bar'),
    );
    const slider = volumeSlider(window);
    const writes: Config[] = [];
    let setVolumeHandler: ((volume: number) => void) | undefined;
    const ipc = {
      on: (channel: string, handler: (value: number) => void) => {
        if (channel === 'setVolume') setVolumeHandler = handler;
      },
      off: () => {},
    };

    const config: Config = {
      enabled: true,
      steps: 1,
      arrowsShortcut: false,
      globalShortcuts: { volumeUp: '', volumeDown: '' },
      savedVolume: 50,
    };

    const api = {
      getVolume: () => 50,
      setVolume: () => {},
    } as unknown as MusicPlayer;

    // The plugin's config write is debounced by one second; run it inline so
    // the test does not wait.
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout;
    try {
      await onPlayerApiReady(api, {
        getConfig: async () => config,
        setConfig: (next: Config) => {
          writes.push({ ...next });
        },
        ipc,
      } as never);

      // A programmatic write must not be persisted as a manual change.
      setVolumeHandler?.(50);
      expect(writes.map((write) => write.savedVolume)).toEqual([50]);

      // The receiver is registered: the main process probes this mark before
      // routing a volume command here (song-controls.ts).
      expect(
        window.document.documentElement.dataset.preciseVolumeReceiver,
      ).toBe('1');

      // A manual drag of three units used to be dropped by the `> 4` heuristic.
      slider.setAttribute('value', '47');
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }

    expect(writes.at(-1)?.savedVolume).toBe(47);

    onUnload();
    expect(
      window.document.documentElement.dataset.preciseVolumeReceiver,
    ).toBeUndefined();
  });
});
