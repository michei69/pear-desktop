import { registerHooks } from 'node:module';

import { Window } from 'happy-dom';

import type { SongInfo } from '@/providers/song-info';

/**
 * The pieces every synced-lyrics test needs to drive the real stores outside the
 * bundler: a DOM, the module hooks that stand in for the plugin's UI half, and
 * the player-shaped fixtures they feed it.
 *
 * Each test file still supplies its own stubs and decides when they are armed —
 * only the plumbing is shared, so the files stay independent specs.
 */

/** `virtual:` modules cannot resolve outside the bundler, so they are served raw. */
const VIRTUAL_STUB =
  'data:text/javascript,export const languageResources = {};';

type ResolveHook = NonNullable<Parameters<typeof registerHooks>[0]['resolve']>;
type LoadHook = NonNullable<Parameters<typeof registerHooks>[0]['load']>;

/** Per-file stubs for the UI modules the store imports. */
type ModuleStubs = Partial<{
  resolve: ResolveHook;
  load: LoadHook;
}>;

let stubs: ModuleStubs = {};
/** Off until a test file arms the hooks for its own dynamic import. */
let stubbing = false;

/** Supplies the hooks a test file wants in front of its dynamic imports. */
export const setUpModuleStubs = (next: ModuleStubs) => {
  stubs = next;
};

/** Arms the hooks for the next dynamic import; the file's own stubs are applied. */
export const startStubbing = () => {
  stubbing = true;
};

/** Disarms the hooks, so later test files load the real modules. */
export const stopStubbing = () => {
  stubbing = false;
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!stubbing) return nextResolve(specifier, context);
    if (specifier.startsWith('virtual:')) {
      return { url: VIRTUAL_STUB, shortCircuit: true };
    }

    return (
      stubs.resolve?.(specifier, context, nextResolve) ??
      nextResolve(specifier, context)
    );
  },
  load(url, context, nextLoad) {
    if (!stubbing) return nextLoad(url, context);

    return stubs.load?.(url, context, nextLoad) ?? nextLoad(url, context);
  },
});

/** The DOM the store expects, without an Electron renderer around it. */
export const installDom = () => {
  const window = new Window();
  const globals = globalThis as unknown as Record<string, unknown>;
  for (const key of [
    'window',
    'document',
    'localStorage',
    'sessionStorage',
    'MutationObserver',
    'customElements',
    'HTMLElement',
    'Element',
    'Node',
    'Event',
    'CustomEvent',
    'DOMParser',
    'XMLHttpRequest',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'location',
    'history',
    'screen',
    'CSS',
  ]) {
    const value = (window as unknown as Record<string, unknown>)[key];
    if (value === undefined) continue;
    try {
      globals[key] = value;
    } catch {
      Object.defineProperty(globals, key, { value, configurable: true });
    }
  }

  (window as unknown as { ipcRenderer: unknown }).ipcRenderer = {
    on() {},
    send() {},
    invoke: () => Promise.resolve(undefined),
  };
};

/** The song the store is playing, for a test that only cares about its id. */
export const song = (videoId: string): SongInfo =>
  ({
    videoId,
    title: `Song ${videoId}`,
    artist: 'Artist',
    songDuration: 100,
  }) as unknown as SongInfo;

/** A watch-next page whose first queue item is the requested song. */
export const watchNextPage = (
  videoId: string,
  title: string,
  byline: string,
  length: string,
) => ({
  contents: {
    singleColumnMusicWatchNextResultsRenderer: {
      tabbedRenderer: {
        watchNextTabbedResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  musicQueueRenderer: {
                    content: {
                      playlistPanelRenderer: {
                        contents: [
                          {
                            playlistPanelVideoRenderer: {
                              videoId,
                              title: { runs: [{ text: title }] },
                              longBylineText: { runs: [{ text: byline }] },
                              lengthText: { runs: [{ text: length }] },
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      },
    },
  },
});

/** Answers `/next` with `page` for the duration of `run`. */
export const withWatchNext = async (
  page: unknown,
  run: () => Promise<void>,
): Promise<void> => {
  const app = document.createElement('ytmusic-app');
  (app as unknown as { networkManager: unknown }).networkManager = {
    fetch: () => Promise.resolve(page),
  };
  document.body.append(app);

  try {
    await run();
  } finally {
    app.remove();
  }
};
