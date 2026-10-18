import { createEffect, createRoot, runWithOwner, type Owner } from 'solid-js';

import { providerNames } from '@/plugins/synced-lyrics/providers';

import { getLyricsReply, type LyricsReply } from './lyrics-reply';

import { V2RendererEvents, type TranslationUpdatedPayload } from '../channels';

import type { RendererContext } from '@/types/contexts';
import type { PluginConfig } from '@/types/plugins';

type LyricsStore = typeof import('@/plugins/synced-lyrics/renderer/store');
type TranslationStore =
  typeof import('@/plugins/synced-lyrics/renderer/translation-store');

/** Reads a reactive value so the calling effect depends on it. */
const track = <T>(value: T): T => value;

/** Runs `trackEffect` as a Solid effect under the synced-lyrics reactive root. */
const watch = (owner: Owner, trackEffect: () => void): (() => void) => {
  const dispose = runWithOwner(owner, () =>
    createRoot((disposeRoot) => {
      createEffect(trackEffect);
      return disposeRoot;
    }),
  );

  return () => dispose?.();
};

const logFailure = (what: string) => (error: unknown) =>
  console.error(`[api-server] pushing ${what} failed:`, error);

/**
 * Pushes the latest message `build` returns whenever the values `trackInputs`
 * reads change, skipping a repeat of the last one and coalescing a burst of
 * changes into one tick. `signature` is the cheap comparison: the payload goes
 * over IPC once, as structured data, and is never serialized to tell whether it
 * changed.
 */
const watchLatest = <T>(
  owner: Owner,
  context: RendererContext<PluginConfig>,
  channel: (typeof V2RendererEvents)[keyof typeof V2RendererEvents],
  what: string,
  build: () => T | null | Promise<T | null>,
  signature: (payload: T) => string,
  trackInputs: () => void,
): (() => void) => {
  let last: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const send = async () => {
    const payload = await build();
    if (payload === null) return;

    const next = signature(payload);
    if (next === last) return;
    last = next;
    context.ipc.send(channel, payload);
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      send().catch(logFailure(what));
    }, 0);
  };

  const dispose = watch(owner, () => {
    trackInputs();
    schedule();
  });

  return () => {
    clearTimeout(timer);
    dispose();
  };
};

/**
 * What makes a lyrics snapshot a different one: the song, the shown provider and
 * each provider's state, sizes and boundary lines. Cheaper than serializing
 * every line, and enough to tell a change from a repeat.
 */
const lyricsSignature = (reply: LyricsReply) =>
  [
    reply.videoId,
    reply.activeProvider,
    ...reply.providers.map((provider) =>
      [
        provider.provider,
        provider.state,
        provider.lyrics?.length,
        provider.lines?.length,
        provider.lines?.[0]?.text,
        provider.lines?.at(-1)?.text,
        provider.translation?.lyrics?.length,
        provider.translation?.lines?.length,
      ].join('~'),
    ),
  ].join('|');

/**
 * Pushes the lyrics snapshots the WebSocket cannot read for itself: every
 * provider's lyrics when they arrive or the active one is switched.
 */
const setupLyricsWatch = (
  context: RendererContext<PluginConfig>,
  store: LyricsStore,
  owner: Owner,
): (() => void) =>
  watchLatest(
    owner,
    context,
    V2RendererEvents.lyricsChanged,
    'lyrics',
    getLyricsReply,
    lyricsSignature,
    () => {
      // Song, selected provider, and every provider's result.
      track(store.lyricsStore.videoId);
      track(store.lyricsStore.provider);
      for (const provider of providerNames) {
        const state = store.lyricsStore.lyrics[provider];
        track(state.state);
        track(state.data);
      }
    },
  );

/** Pushes the translation the app is showing, once it is done. */
const setupTranslationWatch = (
  context: RendererContext<PluginConfig>,
  store: TranslationStore,
  owner: Owner,
): (() => void) =>
  watchLatest(
    owner,
    context,
    V2RendererEvents.translationUpdated,
    'translation',
    (): TranslationUpdatedPayload | null => {
      const current = store.translationStore.current;
      const videoId = store.translationStore.videoId;
      if (!current || current.state !== 'done' || !current.lines.length) {
        return null;
      }
      if (!videoId) return null;

      return {
        videoId,
        language: current.language ?? null,
        provider: current.provider ?? null,
        lines: current.lines,
      };
    },
    (payload) =>
      [
        payload.videoId,
        payload.language,
        payload.provider,
        payload.lines.length,
        payload.lines[0],
        payload.lines.at(-1),
      ].join('|'),
    () => {
      track(store.translationStore.videoId);
      track(store.translationStore.key);
      track(store.translationStore.current?.state);
      track(store.translationStore.current?.lines);
    },
  );

/**
 * The renderer half of the v2 WebSocket's extra event set. The store modules are
 * imported lazily, so a disabled synced-lyrics plugin is never evaluated here.
 */
export const registerV2Events = (
  context: RendererContext<PluginConfig>,
): (() => void) => {
  let disposed = false;
  const disposers: (() => void)[] = [];

  const start = async () => {
    try {
      if (!(await window.mainConfig.plugins.isEnabled('synced-lyrics'))) return;

      const [store, translation, reactive] = await Promise.all([
        import('@/plugins/synced-lyrics/renderer/store'),
        import('@/plugins/synced-lyrics/renderer/translation-store'),
        import('@/plugins/synced-lyrics/renderer/reactive-root'),
      ]);
      if (disposed) return;

      disposers.push(
        setupLyricsWatch(context, store, reactive.reactiveOwner),
        setupTranslationWatch(context, translation, reactive.reactiveOwner),
      );
    } catch (error) {
      console.error('[api-server] v2 events failed:', error);
    }
  };
  start().catch(logFailure('events'));

  return () => {
    disposed = true;
    for (const dispose of disposers.splice(0)) {
      dispose();
    }
  };
};
