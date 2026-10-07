// Copyright (c) 2026 bwedirhan. MIT License.
/**
 * early.ts: preload-stage scanner for skip-ai-slop.
 *
 * Why: the renderer part of the plugin only starts once the page's modules have
 * loaded (about 2.5 s in `pnpm dev`, measured), by which time YouTube Music has
 * already drawn the home page cards. The preload part runs far earlier (about
 * 0.5 s), so this file hides flagged cards from there, before the user sees them.
 *
 * It reads ONLY the DOM (link hrefs and link texts), because page-side
 * properties such as `el.data` are not visible from the preload context. Its
 * rules are the same as the renderer's (allow wins, then block list, keywords,
 * downloaded list), applied to what the links say. It is deliberately a rough
 * first pass: once the renderer is up it takes over, re-judges every card from
 * the real card data, and un-hides anything this file hid by mistake.
 *
 * Hand-off: the renderer sets READY_ATTR on <html> when it starts scanning;
 * this file then stops observing. Cards it hid carry EARLY_ATTR so the
 * renderer knows they are its to confirm or release.
 *
 * Nothing here touches `document` at import time (index.ts also imports this
 * file into the renderer bundle for the two constants below).
 */
import { allowedNames, compileKeywords, normalizeChannels } from './config';

export const EARLY_ATTR = 'data-skip-ai-slop-early';
export const READY_ATTR = 'data-skip-ai-slop-ready';

// keep in sync with index.ts
const CACHE_KEY = 'skip-ai-slop:blacklist';
const SUPPORTED_SCHEMA = 2;

const GIVE_UP_MS = 60_000; // safety: stop watching if the renderer never takes over

// Shelf cards AND search/list rows. Search results come as one API response
// (not infinite scroll), so hiding them before paint doesn't affect YouTube
// Music's "load more" measurement the way shelf cards did.
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
  tracks: Set<string>; // downloaded list
};

let rules: Rules | null = null;
let observer: MutationObserver | null = null;
let giveUpTimer: ReturnType<typeof setTimeout> | null = null;

const buildRules = (cfg: any): Rules => {
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
    const data = raw ? JSON.parse(raw)?.data : null;
    if (
      data &&
      data.version === SUPPORTED_SCHEMA &&
      data.channels &&
      data.tracks
    ) {
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
  if (r.keywords.length && texts.some((t) => r.keywords.some((k) => k.test(t)))) {
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
export const startEarlyScan = async (
  getConfig: () => Promise<unknown> | unknown,
) => {
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
    const cfg = ((await getConfig()) ?? {}) as { hideInPages?: boolean };
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
