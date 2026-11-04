import '@uimaxbai/am-lyrics/am-lyrics.js';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
} from 'solid-js';

import { ErrorDisplay } from './ErrorDisplay';
import { LoadingKaomoji } from './LoadingKaomoji';
import { LyricsPicker } from './LyricsPicker';
import { NotFoundKaomoji } from './NotFoundKaomoji';
import { PlainLyrics } from './PlainLyrics';

import { _ytAPI } from '..';
import { synthesizeTTML } from '../../am-lyrics/ttml';
import { hasLyricText } from '../../providers';
import {
  config,
  currentTime,
  getPlaybackTime,
  isPlaying,
  isVisible,
} from '../renderer';
import { currentLyrics, lyricsStore, splitPlainLyrics } from '../store';
import { translationStore } from '../translation-store';

/**
 * am-lyrics ships its own source switcher, romanization/translation toggles and
 * a download toolbar. They belong to a standalone player, not to this app, and
 * the app already has its own lyrics picker right above the component.
 *
 * The footer must stay in flow: the component measures it to compute the scroll
 * range (`getLayoutScrollHeight`), so `display: none` on it collapses that range
 * and every auto-scroll jumps back to the top. Hide its content and spacing only.
 */
const HIDDEN_CHROME_CSS = `
  .lyrics-header {
    display: none !important;
  }

  .skeleton-line {
    display: none !important;
  }

  .lyrics-footer {
    padding-block: 0 !important;
    margin: 0 !important;
  }

  .lyrics-footer .footer-content {
    display: none !important;
  }
`;

/** The tiny part of the `am-lyrics` public API the app drives. */
type AmLyricsElement = HTMLElement & {
  ttml?: string;
  currentTime: number;
  noAutoAlternates: boolean;
  highlightColor: string;
  /** Renders the `<translation>` entries of the TTML; no network by itself. */
  showTranslation: boolean;
  updateComplete: Promise<unknown>;
};

const createAmLyrics = (
  ttml: string,
  showTranslation: boolean,
): AmLyricsElement => {
  const element = document.createElement('am-lyrics') as AmLyricsElement;

  // Every property is set before the element is connected: `connectedCallback`
  // fetches lyrics when there is no `ttml`, which would be a second network
  // round-trip for lyrics the plugin already fetched.
  element.ttml = ttml;
  element.currentTime = Math.max(0, untrack(getPlaybackTime));
  // The component is fed exactly one source; never let it look for alternates.
  element.noAutoAlternates = true;
  // The translations come from the lyrics plugin, not from the component's own
  // Google requests: enabling the state only renders the TTML's entries.
  element.showTranslation = showTranslation;
  // Follow the app's theme through the component's own palette hook, so light
  // themes do not render white-on-white.
  element.highlightColor = 'var(--ytmusic-text-primary, #ffffff)';
  return element;
};

/** Hide the component's own chrome once its shadow root has rendered. */
const hideComponentChrome = async (element: AmLyricsElement) => {
  await element.updateComplete;

  const root = element.shadowRoot;
  if (!root || root.querySelector('style[data-apple-music]')) return;

  const style = document.createElement('style');
  style.dataset.appleMusic = 'chrome';
  style.textContent = HIDDEN_CHROME_CSS;
  root.append(style);
};

const seekToLine = (timestamp: number) => {
  _ytAPI?.seekTo((timestamp + 10) / 1000);
};

export const AppleMusicStyle = () => {
  const [root, setRoot] = createSignal<HTMLDivElement>();
  const [host, setHost] = createSignal<HTMLDivElement>();
  const [element, setElement] = createSignal<AmLyricsElement>();
  const [picker, setPicker] = createSignal<HTMLDivElement>();
  const [pickerInner, setStickRef] = createSignal<HTMLElement | null>(null);

  // The picker is the app's chrome, not part of the Apple Music design: it
  // stays out of the way like in the standard renderer, sliding in when the
  // list is still at the top or the pointer reaches the top edge.
  let pickerHeight = 0;
  let tabTop = 0;
  let scrollTop = 0;
  let pickerShown: boolean | undefined;
  /** While the player catches up with a click-seek, keep writing the clicked time. */
  let seekPendingUntil = 0;

  const applyPicker = (show: boolean) => {
    const wrapper = picker();
    if (!wrapper || show === pickerShown) return;

    pickerShown = show;
    wrapper.style.setProperty(
      '--apple-music-picker-offset',
      show ? '0px' : `-${pickerHeight}px`,
    );
    // Sliding it out of the tab must not let it eat clicks over the tab header.
    wrapper.style.pointerEvents = show ? '' : 'none';
  };

  const syncPicker = (pointerY?: number) => {
    const nearTop =
      pointerY !== undefined && pointerY - tabTop <= pickerHeight + 8;
    applyPicker(scrollTop <= 8 || nearTop);
  };

  const measureTab = () => {
    tabTop = root()?.getBoundingClientRect().top ?? 0;
    pickerHeight =
      pickerInner()?.getBoundingClientRect().height ?? pickerHeight;
    applyPicker(pickerShown ?? true);
  };

  onMount(() => {
    measureTab();
    window.addEventListener('resize', measureTab);
    onCleanup(() => window.removeEventListener('resize', measureTab));
  });

  createEffect(() => {
    const inner = pickerInner();
    if (!inner) return;

    pickerHeight = inner.getBoundingClientRect().height;
    applyPicker(pickerShown ?? true);
  });

  // Follow the component's own scroll container: at the top the picker stays
  // visible, scrolled down it only slides back in for the top edge.
  createEffect(() => {
    const current = element();
    if (!current) return;

    let container: HTMLElement | null = null;
    let disposed = false;
    const onScroll = () => {
      scrollTop = container?.scrollTop ?? 0;
      syncPicker();
    };

    current.updateComplete.then(() =>
      untrack(() => {
        if (disposed) return;

        container =
          current.shadowRoot?.querySelector<HTMLElement>('.lyrics-container') ??
          null;
        container?.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
      }),
    );

    onCleanup(() => {
      disposed = true;
      container?.removeEventListener('scroll', onScroll);
    });
  });

  const lines = createMemo(() => currentLyrics()?.data?.lines ?? []);

  // The plugin's own translation pass (machine or official), not the TTML's.
  const translations = createMemo(() => {
    if (!config()?.translation?.enabled) return undefined;

    const current = translationStore.current;
    if (
      !current ||
      current.state !== 'done' ||
      translationStore.videoId !== lyricsStore.videoId
    ) {
      return undefined;
    }

    return current.lines;
  });

  // Everything the component renders comes from the lyrics synced-lyrics
  // already fetched and picked, serialized into the TTML it accepts.
  const ttml = createMemo(() => {
    const current = lines();
    if (!current.length) return null;

    return synthesizeTTML(current, {
      translations: translations(),
      translationLanguage: translationStore.current?.language,
    });
  });

  createEffect(() => {
    const container = host();
    const xml = ttml();
    if (!container) return;

    let current = element();

    if (!xml) {
      current?.remove();
      setElement(undefined);
      return;
    }

    if (!current) {
      current = createAmLyrics(xml, Boolean(config()?.translation?.enabled));

      const created = current;
      created.addEventListener('line-click', (event) => {
        const { timestamp } =
          (event as CustomEvent<{ timestamp?: number }>).detail ?? {};
        if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
          return;
        }

        // Paint the jump at once; the player's progress tick is up to 250 ms
        // away, and the frame loop must not drag the lyrics back to the old time.
        created.currentTime = timestamp;
        seekPendingUntil = performance.now() + 400;
        seekToLine(timestamp);
      });
      container.append(created);
      setElement(created);
      hideComponentChrome(created);
    } else if (current.ttml !== xml) {
      current.ttml = xml;
    }

    current.currentTime = Math.max(0, untrack(getPlaybackTime));
  });

  onCleanup(() => element()?.remove());

  createEffect(() => {
    const current = element();
    if (!current) return;

    // Toggling the plugin's translation setting must not reparse the TTML; the
    // component's state only decides whether it renders the translation nodes.
    current.showTranslation = Boolean(config()?.translation?.enabled);
  });

  createEffect(() => {
    const current = element();
    if (!current) return;

    // Pause/seek: the player reports the new position through the store even
    // when no progress ticks are running.
    const time = currentTime();
    if (!isPlaying() && time >= 0) {
      untrack(() => {
        current.currentTime = time;
      });
    }
  });

  createEffect(() => {
    const current = element();
    if (!current || !isPlaying()) return;

    // The player reports its position ~4 times a second; advance the component
    // on animation frames in between so the word wipes stay smooth.
    let frame = requestAnimationFrame(function tick() {
      if (performance.now() >= seekPendingUntil) {
        current.currentTime = Math.max(0, getPlaybackTime());
      }
      frame = requestAnimationFrame(tick);
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });

  return (
    <Show when={isVisible()}>
      <div
        class="lyrics-renderer apple-music-style"
        onMouseLeave={() => syncPicker()}
        onMouseMove={(event) => syncPicker(event.clientY)}
        onPointerEnter={measureTab}
        ref={setRoot}
      >
        <div class="apple-music-picker" ref={setPicker}>
          <section class="apple-music-picker-slot">
            <LyricsPicker setStickRef={setStickRef} />
          </section>
        </div>

        <div class="apple-music-host" ref={setHost}>
          <Show when={!ttml()}>
            <Switch>
              <Match when={currentLyrics()?.state === 'fetching'}>
                <LoadingKaomoji />
              </Match>
              <Match when={currentLyrics()?.state === 'error'}>
                <ErrorDisplay error={currentLyrics().error!} />
              </Match>
              <Match
                when={
                  currentLyrics()?.state === 'done' &&
                  Boolean(currentLyrics()?.data?.lyrics?.trim())
                }
              >
                <div class="apple-music-plain">
                  <For
                    each={splitPlainLyrics(currentLyrics()?.data?.lyrics ?? '')}
                  >
                    {(line, index) => (
                      <PlainLyrics index={index()} line={line} />
                    )}
                  </For>
                </div>
              </Match>
              <Match
                when={
                  currentLyrics()?.state === 'done' &&
                  !hasLyricText(currentLyrics()?.data)
                }
              >
                <NotFoundKaomoji />
              </Match>
            </Switch>
          </Show>
        </div>
      </div>
    </Show>
  );
};
