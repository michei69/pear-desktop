// Clean-room Apple Music-style lyrics renderer. It consumes the plugin's parsed
// LyricLine data directly: no network, no TTML, no third-party component.

import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Translate } from "@pear/sdk/i18n";
import { clamp } from "@pear/sdk/util";
import type { LyricsStore } from "../store.ts";
import type { ViewOptions } from "../view.tsx";
import {
  buildAppleLyrics,
  isPreActive,
  PRE_ACTIVE_MS,
  progressAt,
  timelineAt,
  UNBLUR_MS,
  type AppleGap,
  type AppleLyrics,
  type AppleText,
  type AppleWord,
} from "./model.ts";

const STATE_CLASSES = [
  "active",
  "pre-active",
  "past",
  "future",
  "next-1",
  "next-2",
  "next-3",
  "next-4",
  "prev-1",
  "prev-2",
  "prev-3",
  "prev-4",
  "progressive-unblur",
  "scroll-exiting",
  "gap-collapsing",
  "gap-exiting",
];

const USER_SCROLL_RESUME_MS = 5_000;
const SEEK_THRESHOLD_MS = 500;
const PENDING_SEEK_MS = 400;

export interface AppleLyricsProps {
  store: LyricsStore;
  options: ViewOptions;
  /** The video's position even while paused; null only during ads. */
  position(): number | null;
  seek(ms: number): void;
  /** The app's own picker, rendered over the lyrics as in pear-desktop. */
  picker: ComponentChildren;
  t: Translate;
}

/** The three rows outside the current one are enough for the blur falloff. */
const distanceClass = (side: "next" | "prev", distance: number) => (distance >= 1 && distance <= 4 ? `${side}-${distance}` : "");

export function AppleLyrics({ store, options, position, seek, picker, t }: AppleLyricsProps) {
  const shown = store.shown;
  const current = store.current;
  const lyrics = useMemo(
    () => (shown?.synced && shown.lines.length > 0 ? buildAppleLyrics(shown.lines, shown.translation) : null),
    [shown],
  );
  const hasLyrics = Boolean(lyrics?.rows.some((row) => row.kind === "line"));

  const rootRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const modelRef = useRef<AppleLyrics | null>(lyrics);
  modelRef.current = lyrics;
  const offsetRef = useRef(options.offsetMs);
  offsetRef.current = options.offsetMs;
  const paintRef = useRef<(time: number) => void>(() => {});
  const followingRef = useRef(true);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingSeek = useRef<{ until: number; time: number } | null>(null);
  const last = useRef({ activeRow: -2, preActive: false, scrollRow: -2, time: 0 });
  const scrollFrame = useRef(0);

  // Picker placement and slide-away, exactly the master AppleMusicStyle shell:
  // measured on mount/resize/pointer entry, hidden when the lyrics are scrolled.
  const pickerMetrics = useRef({ height: 0, top: 0, scrollTop: 0, shown: undefined as boolean | undefined });
  const applyPicker = (show: boolean) => {
    const wrapper = pickerRef.current;
    if (!wrapper || show === pickerMetrics.current.shown) return;
    pickerMetrics.current.shown = show;
    wrapper.style.setProperty("--apple-music-picker-offset", show ? "0px" : `-${pickerMetrics.current.height}px`);
    wrapper.style.pointerEvents = show ? "" : "none";
  };
  const syncPicker = (pointerY?: number) => {
    const nearTop = pointerY !== undefined && pointerY - pickerMetrics.current.top <= pickerMetrics.current.height + 8;
    applyPicker(pickerMetrics.current.scrollTop <= 8 || nearTop);
  };
  const measureTab = () => {
    pickerMetrics.current.top = rootRef.current?.getBoundingClientRect().top ?? 0;
    const inner = pickerRef.current?.querySelector<HTMLElement>(".picker");
    pickerMetrics.current.height = inner?.getBoundingClientRect().height ?? pickerMetrics.current.height;
    applyPicker(pickerMetrics.current.shown ?? true);
  };
  useEffect(() => {
    measureTab();
    window.addEventListener("resize", measureTab);
    return () => window.removeEventListener("resize", measureTab);
  }, []);

  // The rows' classes depend only on the active row and the imminent next line;
  // word progress and gap dots change every frame and are written straight to
  // the DOM so playback never re-renders the list.
  const applyClasses = (model: AppleLyrics, time: number) => {
    const state = timelineAt(model, time);
    const preActive = isPreActive(model, state, time);
    if (state.activeRow === last.current.activeRow && preActive === last.current.preActive) {
      last.current.time = time;
      return state;
    }
    last.current.activeRow = state.activeRow;
    last.current.preActive = preActive;
    last.current.time = time;

    const activeOrdinal = state.activeLine >= 0 ? model.lineOrdinal[state.activeLine]! : -1;
    const nextOrdinal = state.nextLine >= 0 ? model.lineOrdinal[state.nextLine]! : -1;

    for (const [index, row] of model.rows.entries()) {
      const element = rowRefs.current.get(row.key);
      if (!element) continue;
      element.classList.remove(...STATE_CLASSES);
      if (row.kind === "gap") continue;

      const ordinal = model.lineOrdinal[index]!;
      const active = index === state.activeLine;
      element.classList.toggle("active", active);
      if (active) element.setAttribute("aria-current", "true");
      else element.removeAttribute("aria-current");
      const pre = !active && index === state.nextLine && preActive;
      if (pre) element.classList.add("pre-active");
      if (active) {
        const next = state.nextLine >= 0 ? model.rows[state.nextLine] : undefined;
        if (next?.kind === "line" && next.startMs - time <= PRE_ACTIVE_MS) element.classList.add("scroll-exiting");
        continue;
      }

      if (activeOrdinal >= 0) {
        if (ordinal < activeOrdinal) {
          element.classList.add("past");
          const distance = distanceClass("prev", activeOrdinal - ordinal);
          if (distance) element.classList.add(distance);
        } else if (!pre) {
          element.classList.add("future");
          const distance = distanceClass("next", ordinal - activeOrdinal);
          if (distance) element.classList.add(distance);
        }
      } else if (nextOrdinal >= 0) {
        if (ordinal < nextOrdinal) element.classList.add("past");
        else if (ordinal > nextOrdinal) element.classList.add("future");
        else if (pre) element.classList.add("pre-active");
        else element.classList.add("future", "next-1");
      }
    }
    return state;
  };

  const paintWords = (row: AppleText, time: number) => {
    const element = rowRefs.current.get(row.key);
    if (!element) return;
    const words = element.querySelectorAll<HTMLElement>(".apple-main .apple-word");
    row.words.forEach((word, index) => {
      words[index]?.style.setProperty("--p", progressAt(time, word.startMs, word.endMs).toFixed(4));
    });
    const background = element.querySelectorAll<HTMLElement>(".apple-bg .apple-word");
    row.background.forEach((word, index) => {
      background[index]?.style.setProperty("--p", progressAt(time, word.startMs, word.endMs).toFixed(4));
    });
  };

  const paintGap = (row: AppleGap, time: number) => {
    const element = rowRefs.current.get(row.key);
    const dots = element?.querySelectorAll<HTMLElement>(".apple-gap-dot");
    if (!element || !dots) return;
    const remaining = row.endMs - time;
    element.classList.toggle("active", remaining > 500);
    element.classList.toggle("gap-collapsing", remaining <= 500);
    element.classList.toggle("gap-exiting", remaining <= 850);
    const length = Math.max(1, row.endMs - row.startMs);
    const exitStart = Math.max(400, length - 850);
    const fade = Math.max(1, exitStart / 3);
    dots.forEach((dot, index) => {
      const opacity = 0.25 + 0.75 * clamp((time - row.startMs - index * fade) / fade, 0, 1);
      dot.style.opacity = String(opacity);
      dot.style.animationDelay = `${-index * 0.6}s`;
    });
  };

  /**
   * Scrolls a row to the selected-line offset (18% compact, 12% medium, 20%
   * wide), with a short ease for playback and an instant jump for seeks. The
   * source component springs its rows; a 1.2 s easeOutCubic reads the same at
   * this size without moving every row with its own animation.
   */
  const scrollToRow = (model: AppleLyrics, rowIndex: number, seeked: boolean) => {
    const scroll = scrollRef.current;
    const row = model.rows[rowIndex];
    const element = row ? rowRefs.current.get(row.key) : undefined;
    if (!scroll || !element) return;

    const ratio = scroll.clientWidth <= 519 ? 0.18 : scroll.clientWidth <= 899 ? 0.12 : 0.2;
    const box = scroll.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const top = Math.max(0, scroll.scrollTop + rect.top - box.top - box.height * ratio);
    cancelAnimationFrame(scrollFrame.current);
    if (seeked || Math.abs(top - scroll.scrollTop) < 1) {
      scroll.scrollTop = top;
      return;
    }

    const from = scroll.scrollTop;
    const delta = top - from;
    const started = performance.now();
    const step = (now: number) => {
      const progress = clamp((now - started) / 1_200, 0, 1);
      const eased = 1 - (1 - progress) ** 3;
      scroll.scrollTop = from + delta * eased;
      if (progress < 1) scrollFrame.current = requestAnimationFrame(step);
    };
    scrollFrame.current = requestAnimationFrame(step);
  };

  useEffect(() => {
    let frame = 0;
    const paint = (time: number) => {
      const model = modelRef.current;
      const scroll = scrollRef.current;
      if (!model || !scroll) return;
      const previousTime = last.current.time;
      const state = applyClasses(model, time);
      if (state.activeLine >= 0) {
        const row = model.rows[state.activeLine];
        if (row?.kind === "line") paintWords(row, time);
      }
      if (state.activeRow >= 0) {
        const row = model.rows[state.activeRow];
        if (row?.kind === "gap") paintGap(row, time);
      }
      const lookahead = timelineAt(model, time + 400);
      if (lookahead.scrollRow >= 0 && lookahead.scrollRow !== last.current.scrollRow && followingRef.current) {
        scrollToRow(model, lookahead.scrollRow, Math.abs(time - previousTime) > SEEK_THRESHOLD_MS);
        last.current.scrollRow = lookahead.scrollRow;
      }

      // Background vocals only take space while their line is sounding or about
      // to sound; they fade/collapse again after their last timed word.
      for (const [index, row] of model.rows.entries()) {
        if (row.kind !== "line" || row.background.length === 0) continue;
        const element = rowRefs.current.get(row.key)?.querySelector<HTMLElement>(".apple-bg");
        if (!element) continue;
        const end = row.background.at(-1)?.endMs ?? row.endMs;
        const sounding = index === state.activeLine;
        const target = index === state.nextLine && row.startMs - time <= PRE_ACTIVE_MS;
        element.classList.toggle("expanded", (sounding || target) && time < end + 450);
      }

      // Start un-blurring the next line two seconds before it starts.
      const nextRow = state.nextLine >= 0 ? model.rows[state.nextLine] : undefined;
      const nextElement = nextRow ? rowRefs.current.get(nextRow.key) : undefined;
      if (nextRow?.kind === "line" && nextElement) {
        const early = nextRow.startMs - time > 0 && nextRow.startMs - time <= UNBLUR_MS;
        nextElement.classList.toggle(
          "progressive-unblur",
          early && !nextElement.classList.contains("active") && !nextElement.classList.contains("pre-active"),
        );
      }
    };
    paintRef.current = paint;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const pending = pendingSeek.current;
      if (pending && performance.now() < pending.until) {
        paint(pending.time);
        return;
      }
      const value = position();
      if (value !== null) paint(Math.max(0, value + offsetRef.current));
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [position]);

  // A new lyric set starts a new follow session and scrolls to its current line.
  useLayoutEffect(() => {
    last.current = { activeRow: -2, preActive: false, scrollRow: -2, time: 0 };
    pendingSeek.current = null;
    followingRef.current = true;
    resumeTimer.current = undefined;
    if (lyrics) {
      const time = position();
      if (time !== null) paintRef.current(Math.max(0, time + offsetRef.current));
    }
  }, [lyrics]);

  // Wheel/touch scrolling pauses following; it resumes after the same delay as
  // pear-desktop, and a click on a line resumes it at once.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const onUserScroll = () => {
      cancelAnimationFrame(scrollFrame.current);
      followingRef.current = false;
      scroll.classList.add("user-scrolling");
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
      resumeTimer.current = setTimeout(() => {
        followingRef.current = true;
        scroll.classList.remove("user-scrolling");
        last.current.scrollRow = -2;
      }, USER_SCROLL_RESUME_MS);
    };
    scroll.addEventListener("wheel", onUserScroll, { passive: true });
    scroll.addEventListener("touchmove", onUserScroll, { passive: true });
    return () => {
      scroll.removeEventListener("wheel", onUserScroll);
      scroll.removeEventListener("touchmove", onUserScroll);
      cancelAnimationFrame(scrollFrame.current);
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    };
  }, [hasLyrics]);

  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), []);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const onScroll = () => {
      pickerMetrics.current.scrollTop = scroll.scrollTop;
      syncPicker();
    };
    scroll.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => scroll.removeEventListener("scroll", onScroll);
  }, [hasLyrics]);

  const seekLine = (row: AppleText) => {
    followingRef.current = true;
    scrollRef.current?.classList.remove("user-scrolling");
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    last.current.scrollRow = -2;
    pendingSeek.current = { until: performance.now() + PENDING_SEEK_MS, time: row.startMs };
    paintRef.current(row.startMs);
    // +10 ms: landing exactly on the start can still resolve to the previous line.
    seek(row.startMs + 10);
  };

  return (
    <div
      class="lyrics-renderer apple-music-style"
      ref={rootRef}
      onMouseLeave={() => syncPicker()}
      onMouseMove={(event) => syncPicker(event.clientY)}
      onPointerEnter={measureTab}
    >
      <div class="apple-music-picker" ref={pickerRef}>
        <section class="apple-music-picker-slot">{picker}</section>
      </div>

      <div class="apple-music-host">
        {hasLyrics && lyrics ? (
          <div class="apple-music-scroll" ref={scrollRef}>
            <div class={`apple-music-lines${lyrics.hasDuet ? " has-duet" : ""}`}>
              {lyrics.rows.map((row) =>
                row.kind === "gap" ? (
                  <div
                    key={row.key}
                    ref={(element) => {
                      if (element) rowRefs.current.set(row.key, element);
                      else rowRefs.current.delete(row.key);
                    }}
                    class="apple-gap"
                    data-start-time={row.startMs}
                    data-end-time={row.endMs}
                    aria-hidden="true"
                  >
                    <div class="apple-gap-dots">
                      <span class="apple-gap-dot" />
                      <span class="apple-gap-dot" />
                      <span class="apple-gap-dot" />
                    </div>
                  </div>
                ) : (
                  <Line
                    key={row.key}
                    row={row}
                    setRef={(element) => {
                      if (element) rowRefs.current.set(row.key, element);
                      else rowRefs.current.delete(row.key);
                    }}
                    onSeek={() => seekLine(row)}
                  />
                ),
              )}
            </div>
          </div>
        ) : (
          <Fallback store={store} current={current} shown={shown} t={t} />
        )}
      </div>
    </div>
  );
}

function Fallback({
  store,
  current,
  shown,
  t,
}: {
  store: LyricsStore;
  current: LyricsStore["current"];
  shown: LyricsStore["shown"];
  t: Translate;
}) {
  if (current.status === "loading") return <LoadingKaomoji />;
  if (current.status === "error") {
    return (
      <div class="error">
        <pre class="error-title">{t("plugins.synced-lyrics.errors.fetch", "An error occurred while fetching the lyrics.")}</pre>
        <pre class="error-detail">{current.message}</pre>
        <button type="button" class="retry" onClick={() => store.retry(store.selected)}>
          {t("plugins.synced-lyrics.refetch-btn.normal", "Refetch lyrics")}
        </button>
      </div>
    );
  }
  if (shown && !shown.synced) {
    return (
      <div class="apple-music-plain">
        <PlainLyrics texts={shown.texts} romanized={shown.romanized} translation={shown.translation} />
      </div>
    );
  }
  return (
    <div class="kaomoji" role="status" aria-label={t("plugins.synced-lyrics.errors.not-found", "No lyrics found for this song.")}>
      ＼(〇_ｏ)／
    </div>
  );
}

const LOADING_FRAMES = ["(>_<)", "{ (>_<) }", "{{ (>_<) }}", "{{{ (>_<) }}}", "{{ (>_<) }}", "{ (>_<) }"];

function LoadingKaomoji() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, []);
  return (
    <div class="kaomoji" role="status" aria-busy="true">
      {LOADING_FRAMES[frame % LOADING_FRAMES.length]}
    </div>
  );
}

function PlainLyrics({ texts, romanized, translation }: { texts: string[]; romanized: (string | null)[]; translation: (string | null)[] }) {
  return (
    <div class="lines plain">
      {texts.map((text, index) => {
        const translated = translation[index];
        return text ? (
          <div key={index} class={`line${/^\[.*\]$/.test(text) ? " section" : ""}`}>
            <span class="text" dir="auto">
              {text}
            </span>
            {romanized[index] && (
              <span class="romanized" dir="auto">
                {romanized[index]}
              </span>
            )}
            {translated && translated !== text && (
              <span class="translation" dir="auto">
                {translated}
              </span>
            )}
          </div>
        ) : (
          <div key={index} class="spacer" />
        );
      })}
    </div>
  );
}

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
/** One soft edge per word; long words get a wider feather, CJK a narrower one. */
function feather(word: AppleWord) {
  const text = word.text.trim();
  if (CJK.test(text)) return "0.3em";
  const chars = text.length;
  return `${(0.75 + 0.45 * clamp((chars - 6) / 10, 0, 1)).toFixed(2)}em`;
}

interface LineProps {
  row: AppleText;
  setRef(element: HTMLDivElement | null): void;
  onSeek(): void;
}

function Line({ row, setRef, onSeek }: LineProps) {
  const dir = row.rtl ? "rtl" : "auto";
  const backgroundFirst = row.background[0];
  const mainStart = row.words[0]?.startMs ?? row.startMs;
  const backgroundBefore = Boolean(backgroundFirst && backgroundFirst.startMs < mainStart);
  const classNames = [
    "apple-line",
    row.words.length ? "word-synced" : "",
    row.alignment === "end" ? "singer-right" : "",
    row.alignment !== "end" ? "singer-left" : "",
    row.rtl ? "rtl" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const content = (words: AppleWord[], kind: "main" | "bg") =>
    words.length ? (
      <span class={`apple-${kind}-words`}>
        {words.map((word, index) => (
          <span key={index} class="apple-word" data-start={word.startMs} data-end={word.endMs} style={{ "--apple-feather": feather(word) }}>
            {word.text}
          </span>
        ))}
      </span>
    ) : (
      <span>{row.text}</span>
    );

  return (
    <div
      ref={setRef}
      class={classNames}
      data-key={row.key}
      data-start-time={row.startMs}
      role="button"
      tabIndex={0}
      onClick={onSeek}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSeek();
        }
      }}
      aria-label={row.text}
    >
      <div class="apple-line-box">
        {backgroundBefore && (
          <div class="apple-bg background-before" dir={dir}>
            <div class="apple-bg-inner">{content(row.background, "bg")}</div>
          </div>
        )}
        <div class="apple-main" dir={dir}>
          {row.words.length ? content(row.words, "main") : row.text}
        </div>
        {!backgroundBefore && row.background.length > 0 && (
          <div class="apple-bg background-after" dir={dir}>
            <div class="apple-bg-inner">{content(row.background, "bg")}</div>
          </div>
        )}
        {row.translation && (
          <div class="apple-translation" dir="auto">
            {row.translation}
          </div>
        )}
      </div>
    </div>
  );
}
