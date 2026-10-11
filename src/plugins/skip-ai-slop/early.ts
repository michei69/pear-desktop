// Copyright (c) 2026 bwedirhan. MIT License.
/**
 * Preload scanner: the renderer starts ~2.5 s in (`pnpm dev`, measured), after
 * YouTube Music has drawn the home cards, while preload runs ~0.5 s, so flagged
 * cards are hidden here before they are seen. Reads ONLY the DOM (link hrefs and
 * texts; page data like `el.data` is invisible from preload) with the renderer's
 * rules (allow wins, then block list, keywords, downloaded list), as a rough
 * first pass the renderer re-judges and un-hides. Hand-off: READY_ATTR on <html>
 * stops this observer, and cards hidden here carry EARLY_ATTR. Touches
 * `document` only at call time, never at import (index.ts imports the constants).
 */
import {
  allowedNames,
  compileKeywords,
  normalizeChannels,
  type SkipAiSlopConfig,
} from './config';

export const EARLY_ATTR = 'data-skip-ai-slop-early';
export const READY_ATTR = 'data-skip-ai-slop-ready';

// keep in sync with index.ts
const CACHE_KEY = 'skip-ai-slop:blacklist';
const SUPPORTED_SCHEMA = 2;

const GIVE_UP_MS = 60_000; // SAFETY: stop watching if the renderer never takes over

// Shelf cards and search/list rows. Search results are one API response, not
// infinite scroll, so hiding before paint doesn't skew the "load more" measurement.
const CARD_SELECTOR = [
  'ytmusic-two-row-item-renderer',
  'ytmusic-multi-row-list-item-renderer',
  'ytmusic-responsive-list-item-renderer',
]
  .map((tag) => `${tag}:not(ytmusic-player-queue *)`)
  .join(', ');

const CHANNEL_RE = /(?:^|[/=])(UC[\w-]{22})(?![\w-])/;
const VIDEO_RE = /[?&]v=([\w-]{11})/;

type Rules = {
  allow: Set<string>;
  allowNames: Set<string>; // lower-cased names of allowed channels
  block: Set<string>;
  keywords: RegExp[]; // whole-word matchers, see compileKeyword in config.ts
  channels: Set<string>; // downloaded list
  tracks: Set<string>;
};

let rules: Rules | null = null;
let observer: MutationObserver | null = null;
let giveUpTimer: ReturnType<typeof setTimeout> | null = null;

const buildRules = (cfg: Partial<SkipAiSlopConfig>): Rules => {
  const out: Rules = {
    allow: new Set(normalizeChannels(cfg.userAllow).map((c) => c.id)),
    allowNames: allowedNames(cfg.userAllow),
    block: new Set(normalizeChannels(cfg.userBlock).map((c) => c.id)),
    keywords: compileKeywords(cfg.keywords),
    channels: new Set(),
    tracks: new Set(),
  };
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    // keep in sync with the shape index.ts writes (loadCachedList)
    const cached = (raw ? JSON.parse(raw) : null) as {
      data?: {
        version?: unknown;
        channels?: Record<string, unknown>;
        tracks?: Record<string, unknown>;
      };
    } | null;
    const data = cached?.data;
    if (data?.version === SUPPORTED_SCHEMA && data.channels && data.tracks) {
      out.channels = new Set(Object.keys(data.channels));
      out.tracks = new Set(Object.keys(data.tracks));
    }
  } catch {
    // no usable cache: user lists and keywords still work
  }
  return out;
};

const isFlagged = (card: Element, r: Rules): boolean => {
  const channelIds: string[] = [];
  const videoIds: string[] = [];
  const texts: string[] = [];
  for (const a of card.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    const ch = CHANNEL_RE.exec(href);
    if (ch) channelIds.push(ch[1]);
    const v = VIDEO_RE.exec(href);
    if (v) videoIds.push(v[1]);
    const text = a.textContent?.trim();
    if (text) texts.push(text);
  }
  const ids = [...videoIds, ...channelIds];
  if (ids.some((id) => r.allow.has(id))) return false; // allow always wins
  if (texts.some((t) => r.allowNames.has(t.trim().toLowerCase()))) return false; // ...also by name
  if (ids.some((id) => r.block.has(id))) return true;
  if (
    r.keywords.length &&
    texts.some((t) => r.keywords.some((k) => k.test(t)))
  ) {
    return true;
  }
  if (channelIds.some((id) => r.channels.has(id))) return true;
  if (videoIds.some((id) => r.tracks.has(id))) return true;
  return false;
};

const evaluate = (card: Element) => {
  if (!rules || card.hasAttribute(EARLY_ATTR)) return;
  if (!isFlagged(card, rules)) return; // links may not be drawn yet: re-judged on later mutations
  card.setAttribute(EARLY_ATTR, '');
  (card as HTMLElement).style.display = 'none';
};

const onMutations = (records: MutationRecord[]) => {
  if (document.documentElement?.hasAttribute(READY_ATTR)) {
    stopEarlyScan(); // renderer has taken over
    return;
  }
  if (!rules) return;
  const cards = new Set<Element>();
  const collect = (node: Node) => {
    if (!(node instanceof Element)) return;
    const own = node.closest(CARD_SELECTOR);
    if (own) cards.add(own);
    else node.querySelectorAll(CARD_SELECTOR).forEach((c) => cards.add(c));
  };
  for (const rec of records) {
    if (rec.type === 'attributes') collect(rec.target);
    else rec.addedNodes.forEach(collect);
  }
  // runs inside the observer callback, i.e. before the browser paints the change
  cards.forEach(evaluate);
};

export const stopEarlyScan = () => {
  observer?.disconnect();
  observer = null;
  if (giveUpTimer) {
    clearTimeout(giveUpTimer);
    giveUpTimer = null;
  }
};

/** Call from the plugin's preload start(). Cards seen before the config arrives are judged once it does. */
export const startEarlyScan = async (getConfig: () => unknown) => {
  if (observer) return;
  observer = new MutationObserver(onMutations);
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href'], // link targets are filled in after the card element appears
  });
  giveUpTimer = setTimeout(stopEarlyScan, GIVE_UP_MS);

  try {
    const cfg = ((await getConfig()) ?? {}) as Partial<SkipAiSlopConfig>;
    if (cfg.hideInPages === false) {
      stopEarlyScan();
      return;
    }
    rules = buildRules(cfg);
  } catch {
    stopEarlyScan();
    return;
  }
  document.querySelectorAll(CARD_SELECTOR).forEach(evaluate);
};
