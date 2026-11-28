// Puts the lyrics view into YTM's Lyrics tab: a shadow-DOM element inside the
// tab panel, shown (and YTM's own lyrics hidden) while that tab is selected.

import type { PageContextOf } from "@pear/sdk";
import { isolateKeys, shadowHost } from "@pear/sdk/dom";
import { readSongDetails } from "@pear/sdk/song-details";
import { render } from "preact";
import { lineAt } from "../lrc.ts";
import type { LyricsConfig, schema } from "../schema.ts";
import { ROMANIZATION_SCRIPTS, type ActiveLyricLine, type RomanizationSettings } from "../types.ts";
import { activeLineAt } from "./active-line.ts";
import { LyricsStore, type Backend, type Options } from "./store.ts";
import { appleStyles } from "./apple/styles.ts";
import { lyricsStyles } from "./styles.ts";
import { LyricsView, viewState, type ViewOptions } from "./view.tsx";

type Commands = Required<Omit<Backend, "details">> & {
  /** The settings action; the page never calls it, but the host commands are one set. */
  clearTranslationCache(): Promise<number>;
  /** The active line, for statusbar-lyrics; the host relays it on the app emitter. */
  activeLine(line: ActiveLyricLine | null): void;
};

type Ctx = PageContextOf<typeof schema, Commands>;

const storeOptions = (config: LyricsConfig): Options => ({
  preferred: config.preferredProvider,
  inexact: config.showLyricsEvenIfInexact,
  romanization: Object.fromEntries(
    ROMANIZATION_SCRIPTS.map((script) => [script, config.romanizationScripts.includes(script)]),
  ) as RomanizationSettings,
  chinese: config.convertChinese,
  japanese: config.convertJapanese,
  priority: config.providerPriority,
  usePriorityList: config.usePriorityList,
  typePriority: config.lyricsTypePriority,
  translation: { enabled: config.translationEnabled, targetLanguage: config.translationTargetLanguage },
});

const viewOptions = (config: LyricsConfig): ViewOptions => ({
  effect: config.lineEffect,
  gapText: config.gapText,
  gapTextCustom: config.gapTextCustom,
  showTimeCodes: config.showTimeCodes,
  offsetMs: config.offsetMs,
  preciseTiming: config.preciseTiming,
  fontSize: config.lyricsFontSize,
  style: config.lyricsStyle,
  showCustomSearch: config.showCustomSearchButton,
});

export function mountLyrics(ctx: Ctx) {
  const store = createStore(ctx);
  const { host: element, root } = shadowHost("pear-synced-lyrics", lyricsStyles + appleStyles);
  // The core performance switches are restart-only, so reading them once is
  // enough. The styles stay inside the shadow root: the core's own sheet is
  // adopted on the document and never crosses into it.
  const performance = ctx.core("performance");
  const performanceMode = performance.css ? "css" : performance.animations ? "animations" : "";
  if (performanceMode) element.setAttribute("data-performance", performanceMode);
  // Keep YTM's global shortcuts from reacting to keys in here.
  isolateKeys(element, ctx.signal);

  // null pauses the view's per-frame work: during ads, and while the window is off screen.
  const now = () => (ctx.isWindowVisible() ? position() : null);
  /** The video's position even while paused (null only during ads); Apple seeks while paused. */
  const position = () => {
    const video = ctx.player.video();
    if (!video || ctx.player.state.ad) return null;
    return video.currentTime * 1000;
  };
  const seek = (ms: number) => ctx.player.control({ type: "seek", seconds: ms / 1000 });
  const scroller = () => element.parentElement;

  let options = viewOptions(ctx.config);
  let open = false;
  // The line the view last reported, serialized: the renderers report their
  // active line whenever it or its romanization changes, and the store re-renders
  // them for unrelated updates (a translation arrives, the picker moves).
  let reportedLine: string | undefined;
  const reportLine = (line: ActiveLyricLine | null) => {
    const key = line ? `${line.text}\u0000${line.romanized ?? ""}` : "";
    if (key === reportedLine) return;
    reportedLine = key;
    // The host relays it to statusbar-lyrics. A failure is not worth a retry (the
    // next line replaces it) and the host may already be stopping.
    void ctx.host.invoke("activeLine", line).catch(() => {});
  };
  const draw = () => {
    // The Apple style fills the tab, so the page stylesheet can size the host.
    element.dataset.style = options.style;
    render(
      open ? (
        <LyricsView
          store={store}
          options={options}
          now={now}
          position={position}
          seek={seek}
          scroller={scroller}
          t={ctx.t}
          onActiveLine={reportLine}
        />
      ) : null,
      root,
    );
  };

  /**
   * Whether something outside the Lyrics tab needs the current line: the macOS
   * menu bar. The store otherwise searches only while the tab is open.
   */
  const wantsHeadless = () => ctx.pluginEnabled("statusbar-lyrics");

  // The view reports the active line while the tab is open, but it unmounts with
  // the tab. This follower keeps the menu bar current the rest of the time,
  // using the same line math as the view.
  let follower = 0;
  let followerIndex = -1;
  const follow = () => {
    follower = 0;
    if (open || !wantsHeadless() || !store.shown) {
      followerIndex = -1;
      reportLine(null);
      return;
    }
    // Keep the last line while minimized; no need to scan frames off screen.
    const ms = ctx.isWindowVisible() ? position() : null;
    if (ms !== null) {
      const lines = store.shown.lines;
      const shifted = ms + options.offsetMs;
      const started = lineAt(lines, shifted);
      const index = !options.preciseTiming ? started : started >= 0 && shifted < lines[started]!.endMs ? started : -1;
      if (index !== followerIndex) {
        followerIndex = index;
        reportLine(activeLineAt(store.shown, index));
      }
    }
    follower = requestAnimationFrame(follow);
  };
  const startHeadless = () => {
    if (follower || open || !wantsHeadless()) return;
    follower = requestAnimationFrame(follow);
  };
  const stopHeadless = () => {
    if (!follower) return;
    cancelAnimationFrame(follower);
    follower = 0;
    followerIndex = -1;
  };

  const setOpen = (next: boolean) => {
    if (next === open) return;
    open = next;
    element.toggleAttribute("open", open);
    store.setActive(open || wantsHeadless());
    if (open) {
      stopHeadless();
    } else {
      // The view's cleanup cleared the line; the follower picks it up again.
      startHeadless();
    }
    draw();
  };
  attachToLyricsTab(ctx, element, setOpen);

  ctx.player.on("trackChange", (track) => {
    store.load(track);
    store.setActive(open || wantsHeadless());
    startHeadless();
  });
  store.load(ctx.player.state.track);
  store.setActive(open || wantsHeadless());
  startHeadless();

  const unsubscribe = store.subscribe(() => {
    element.dataset.state = viewState(store);
    // Lyrics can arrive after the track change that started the follower.
    startHeadless();
  });

  ctx.onCleanup(() => {
    stopHeadless();
    unsubscribe();
    render(null, root);
    element.remove();
  });

  ctx.onConfigChange((config) => {
    options = viewOptions(config);
    store.setOptions(storeOptions(config));
    draw();
  });
}

function createStore(ctx: Ctx) {
  return new LyricsStore(
    {
      search: (provider, query) => ctx.host.invoke("search", provider, query),
      romanize: (lines, scripts) => ctx.host.invoke("romanize", lines, scripts),
      convertChinese: (lines, mode) => ctx.host.invoke("convertChinese", lines, mode),
      convertJapanese: (lines, mode) => ctx.host.invoke("convertJapanese", lines, mode),
      translate: (request) => ctx.host.invoke("translate", request),
      customQuery: (videoId) => ctx.host.invoke("customQuery", videoId),
      setCustomQuery: (videoId, query) => ctx.host.invoke("setCustomQuery", videoId, query),
      removeCustomQuery: (videoId) => ctx.host.invoke("removeCustomQuery", videoId),
      details(videoId) {
        const details = ctx.player.api ? readSongDetails(ctx.player.api) : null;
        return details?.videoId === videoId ? details : null;
      },
    },
    storeOptions(ctx.config),
    // Nothing is looked up until the Lyrics tab opens (and then only for the tracks shown).
    false,
  );
}

/**
 * Keeps `element` in the Lyrics tab's panel and reports whether that tab is selected.
 * YTM builds the player page lazily and may re-render it, so both are re-found on changes.
 */
function attachToLyricsTab(ctx: Ctx, element: HTMLElement, setOpen: (open: boolean) => void) {
  let tabObserver: MutationObserver | undefined;
  let observedTab: HTMLElement | null = null;
  ctx.onCleanup(() => tabObserver?.disconnect());

  // The tab header: YTM disables it for tracks without its own lyrics; ours may still have some.
  const observeTab = (tab: HTMLElement) => {
    const sync = () => {
      if (tab.hasAttribute("disabled")) tab.removeAttribute("disabled");
      setOpen(tab.getAttribute("aria-selected") === "true");
    };
    const observer = new MutationObserver(sync);
    observer.observe(tab, { attributes: true, attributeFilter: ["disabled", "aria-selected"] });
    sync();
    return observer;
  };

  const attach = () => {
    const panel = ctx.$("lyrics.panel");
    if (panel && element.parentElement !== panel) {
      panel.append(element);
    }
    const tab = ctx.$("lyrics.tab");
    if (tab && tab !== observedTab) {
      tabObserver?.disconnect();
      observedTab = tab;
      tabObserver = observeTab(tab);
    }
  };
  ctx.observe("player.page", { childList: true, subtree: true }, attach);
  void ctx.waitFor("player.page").then(attach, () => {});
}
