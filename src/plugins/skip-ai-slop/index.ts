// Copyright (c) 2026 bwedirhan. MIT License.
/**
 * skip-ai-slop — Pear Desktop plugin (v4 draft)
 *
 * Copy to: src/plugins/skip-ai-slop/index.ts in a pear-desktop checkout, then
 * register it the same way the other plugins are registered (see how
 * src/plugins/skip-silences or sponsorblock are listed).
 *
 * Plugin shape (createPlugin, config, renderer.start/stop/onPlayerApiReady)
 * follows the "Creating a plugin" section of the pear-desktop README.
 *
 * Tested in `pnpm dev` (see README): videoId / channelId skipping and the real
 * download from GitHub work. STILL UNVERIFIED:
 *  - the packaged (production) build
 *  - that getPlayerResponse() already returns the NEW track when 'loadedmetadata'
 *    fires (if not, 'durationchange' below acts as a second chance)
 *  - the "UNVERIFIED" notes further down (automix payload, feedback menu fields,
 *    YouTube Music element names)
 *
 * To avoid depending on app-internal event names, track changes are detected with
 * standard <video> element events instead of app-specific custom events.
 */
import { createPlugin } from '@/utils';

import { AllowedList, BlockedList, RecentList } from './ChannelLists';
import {
  allowedNames,
  compileKeywords,
  clearBlacklistNames,
  defaultConfig,
  EVT_CLEAR,
  EVT_DOWNLOAD,
  EVT_INFO,
  EVT_STATUS,
  hasBlacklistNames,
  type ListStatus,
  normalizeChannels,
  recordFiltered,
  type SkipAiSlopConfig,
  writeBlacklistNames,
} from './config';
import { EARLY_ATTR, READY_ATTR, startEarlyScan, stopEarlyScan } from './early';
import { KeywordList } from './KeywordList';
import { ListTools } from './ListTools';
import { SearchBlocked } from './SearchBlocked';

const BLACKLIST_URL =
  'https://raw.githubusercontent.com/bwedirhan/pear-desktop-ai-slop-filter/main/blacklist.json';
const CACHE_KEY = 'skip-ai-slop:blacklist';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // re-check hourly; refreshList() exits early while cache is fresh
const SUPPORTED_SCHEMA = 2;
const MAX_SKIPS = 5; // safety: stop skipping if this many skips happen...
const SKIP_WINDOW_MS = 10_000; // ...within this window (e.g. whole queue is blacklisted)

type Entry = { name?: string; title?: string; reason?: string; added_at?: string };
type Blacklist = {
  version: number;
  updated_at: string;
  channels: Record<string, Entry>;
  tracks: Record<string, Entry>;
};
type Config = SkipAiSlopConfig;

let keywords: RegExp[] = []; // whole-word matchers (see compileKeyword in config.ts)
let allowIds = new Set<string>();
let allowNames = new Set<string>(); // lower-cased names of allowed channels
let blockIds = new Set<string>();
// Artists learned from a flagged uploader during this session only. Never saved
// to the config: an uploader/distributor on the list must not permanently block
// a real artist who just happens to be queued next to it. "Allow" in the
// settings still overrides it (allow always wins).
let sessionBlockIds = new Set<string>();
// Bumped whenever anything that decides "flagged or not" changes (keywords,
// allow/block lists, the downloaded list). Cached per-card verdicts are only
// trusted while they carry the current number.
let filterVersion = 0;
let savePluginConfig:
  | ((c: Partial<Omit<Config, 'enabled'>>) => Promise<void> | void)
  | null = null;
const rebuildKeywords = () => {
  keywords = compileKeywords(config.keywords);
  allowIds = new Set(normalizeChannels(config.userAllow).map((c) => c.id));
  allowNames = allowedNames(config.userAllow);
  blockIds = new Set(normalizeChannels(config.userBlock).map((c) => c.id));
  filterVersion++;
};

/** Channels YouTube was told "don't recommend" (by us or by hand) stay blocked locally. */
const addBlocked = (id: string, name: string) => {
  if (allowIds.has(id) || blockIds.has(id)) return;
  const next = [...normalizeChannels(config.userBlock), { id, name: name || id }];
  config = { ...config, userBlock: next };
  rebuildKeywords();
  void savePluginConfig?.({ userBlock: next });
};
const learnArtist = (id: string) => {
  if (allowIds.has(id) || blockIds.has(id) || sessionBlockIds.has(id)) return;
  sessionBlockIds.add(id);
  filterVersion++;
};
const matchesKeyword = (text?: string) => {
  if (!text) return false;
  return keywords.some((k) => k.test(text));
};

let list: Blacklist | null = null;
let config: Config = { ...defaultConfig };
let api: any = null;
let active = false;
let video: HTMLVideoElement | null = null;
let lastCheckedId: string | null = null;
let recentSkips: number[] = [];
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const isValid = (d: any): d is Blacklist =>
  !!d &&
  d.version === SUPPORTED_SCHEMA &&
  typeof d.channels === 'object' &&
  d.channels !== null &&
  typeof d.tracks === 'object' &&
  d.tracks !== null;

const has = (o: Record<string, Entry>, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

/**
 * Matching only needs the IDs. Dropping names and reasons makes the cached copy
 * (and the in-memory one) roughly 85% smaller, so it parses fast at startup and
 * stays far from the localStorage quota, which early.ts also depends on. Names
 * for the settings search are saved separately (writeBlacklistNames).
 */
const slim = (d: Blacklist): Blacklist => {
  const keysOnly = (o: Record<string, Entry>) =>
    Object.fromEntries(Object.keys(o).map((k) => [k, {} as Entry]));
  return {
    version: d.version,
    updated_at: d.updated_at,
    channels: keysOnly(d.channels),
    tracks: keysOnly(d.tracks),
  };
};

/**
 * Reads the downloaded list from localStorage. Synchronous, so the list is
 * usable the moment the plugin starts. Returns true when the cache is still
 * fresh; an expired cache is still loaded (better than nothing while the new
 * one downloads).
 */
const loadCachedList = (): boolean => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { data?: unknown; ts?: number };
      if (isValid(parsed.data)) {
        list = parsed.data;
        return !!parsed.ts && Date.now() - parsed.ts < CACHE_TTL_MS;
      }
    }
  } catch {
    // ignore corrupt cache
  }
  return false;
};

/** Downloads the list from GitHub. Returns true when a new list was installed. */
const downloadList = async (): Promise<boolean> => {
  try {
    const res = await fetch(BLACKLIST_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: unknown = await res.json();
    if (!isValid(data)) {
      console.warn('[skip-ai-slop] invalid or unsupported blacklist, keeping old list');
      return false;
    }
    writeBlacklistNames(data); // names for the settings search, kept apart from the matching cache
    list = slim(data);
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ data: list, ts: Date.now() }),
      );
    } catch {
      /* storage full or unavailable: the list still works for this session */
    }
    return true;
  } catch (err) {
    console.warn('[skip-ai-slop] refresh failed; using cached list if any', err);
    return false;
  }
};

/** A new list arrived: apply it to everything already on screen / playing. */
const onListChanged = () => {
  filterVersion++;
  lastCheckedId = null; // re-evaluate the playing track against the new list
  scanSearchResults();
  scanQueue();
  check();
};

/** Hourly: download again only when the cache has expired. */
const refreshList = async () => {
  if (loadCachedList()) return; // cache still fresh
  if (await downloadList()) onListChanged();
};

// ---- buttons in Settings -> "Community list" -------------------------------
const emitStatus = (text: string, busy = false) =>
  window.dispatchEvent(
    new CustomEvent<ListStatus>(EVT_STATUS, { detail: { text, busy } }),
  );

const listSummary = () =>
  list
    ? `Loaded: ${Object.keys(list.channels).length} channels, ${Object.keys(list.tracks).length} tracks (list dated ${list.updated_at}).`
    : 'No list loaded right now.';

const onInfoRequest = () => emitStatus(listSummary());

const onDownloadRequest = async () => {
  emitStatus('Downloading…', true);
  const ok = await downloadList();
  if (ok) onListChanged();
  emitStatus(
    ok
      ? `Downloaded. ${listSummary()}`
      : 'Download failed, the old list was kept (details in the console).',
  );
};

const onClearRequest = () => {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
  clearBlacklistNames();
  list = null;
  onListChanged(); // re-judge everything without the community list
  emitStatus(
    'Cache cleared. The community list is off until you press "Download list now" (or restart the app).',
  );
};

const listenForListTools = () => {
  window.addEventListener(EVT_INFO, onInfoRequest);
  window.addEventListener(EVT_DOWNLOAD, onDownloadRequest);
  window.addEventListener(EVT_CLEAR, onClearRequest);
};
const stopListeningForListTools = () => {
  window.removeEventListener(EVT_INFO, onInfoRequest);
  window.removeEventListener(EVT_DOWNLOAD, onDownloadRequest);
  window.removeEventListener(EVT_CLEAR, onClearRequest);
};

const baseReason = (
  videoId?: string,
  channelIds: string[] = [],
  title?: string,
  author?: string,
): string | null => {
  const ids = [videoId, ...channelIds].filter(Boolean) as string[];
  // allow always wins: by id, or by name when the card shows an allowed channel's
  // name under a different id than the one that was allowed
  const nameAllowed = (t?: string) => !!t && allowNames.has(t.trim().toLowerCase());
  if (ids.some((id) => allowIds.has(id)) || nameAllowed(title) || nameAllowed(author)) {
    return null;
  }
  if (ids.some((id) => blockIds.has(id))) return 'user-block';
  if (ids.some((id) => sessionBlockIds.has(id))) return 'learned-artist';
  if (matchesKeyword(title)) return 'keyword:title';
  if (matchesKeyword(author)) return 'keyword:author';
  if (!list) return null;
  if (channelIds.some((c) => has(list!.channels, c))) return 'channel';
  if (videoId && has(list.tracks, videoId)) return 'track';
  return null;
};

const matchedChannel = (channelIds: string[]): string | undefined =>
  channelIds.find(
    (c) => (list && has(list.channels, c)) || sessionBlockIds.has(c),
  );

const reasonToSkip = (
  videoId?: string,
  channelIds: string[] = [],
  title?: string,
  author?: string,
): string | null => {
  const reason = baseReason(videoId, channelIds, title, author);
  if (reason && reason !== 'user-block') {
    // Record the channel that actually matched, not just the first one on the
    // card: otherwise "Allow" in the settings could allow the wrong channel.
    const matched =
      reason === 'channel' || reason === 'learned-artist'
        ? matchedChannel(channelIds)
        : undefined;
    const id = matched ?? channelIds[0];
    if (id) {
      const listedName =
        reason === 'channel' && list ? list.channels[id]?.name : undefined;
      recordFiltered({ id, name: listedName || author || id, reason });
    }
  }
  return reason;
};

const canSkipNow = () => {
  const now = Date.now();
  recentSkips = recentSkips.filter((t) => now - t < SKIP_WINDOW_MS);
  return recentSkips.length < MAX_SKIPS;
};

// ---- queue pre-filter -------------------------------------------------------
// The queue (what YouTube Music builds when a playlist is opened) is already in
// the page, so scanning it costs no network requests. Flagged tracks are
// removed locally in one go, so playback never has to skip them one by one.
type QueueEl = HTMLElement & {
  dispatch(obj: { type: string; payload?: unknown }): void;
  queue?: { getItems(): any[] };
};
let queueTimer: ReturnType<typeof setInterval> | null = null;
const QUEUE_SCAN_MS = 2000;

// Autoplay (automix) items may come wrapped differently from queue items, so
// when the known shapes miss, look for the first object that has a videoId and a title.
const findRenderer = (node: any, depth = 0): any => {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (typeof node.videoId === 'string' && node.title) return node;
  for (const v of Object.values(node)) {
    const found = findRenderer(v, depth + 1);
    if (found) return found;
  }
  return null;
};

const queueItemInfo = (item: any) => {
  const r =
    item?.playlistPanelVideoRenderer ??
    item?.playlistPanelVideoWrapperRenderer?.primaryRenderer
      ?.playlistPanelVideoRenderer ??
    findRenderer(item);
  if (!r?.videoId) return null;
  const runs: any[] = r.longBylineText?.runs ?? r.shortBylineText?.runs ?? [];
  return {
    videoId: r.videoId as string,
    selected: !!r.selected,
    title: ((r.title?.runs ?? []) as any[]).map((x) => x.text).join(''),
    author: (runs[0]?.text as string | undefined) ?? '',
    channelIds: runs
      .map((x) => x?.navigationEndpoint?.browseEndpoint?.browseId)
      .filter((x): x is string => typeof x === 'string'),
  };
};

const findQueueInfo = (videoId: string) => {
  const items = document.querySelector<QueueEl>('#queue')?.queue?.getItems?.();
  for (const item of items ?? []) {
    const info = queueItemInfo(item);
    if (info?.videoId === videoId) return info;
  }
  return null;
};

// While flagged tracks are being removed one by one, further scans are ignored so
// two scans never remove or skip at the same time.
let removingFromQueue = false;

const scanQueue = () => {
  if (!active || !api || removingFromQueue) return;
  hookStore();
  const el = document.querySelector<QueueEl>('#queue');
  const items = el?.queue?.getItems?.();
  if (!el || !items?.length) return;

  const currentId: string | undefined = api.getPlayerResponse?.()?.videoDetails
    ?.videoId;
  const flagged: string[] = []; // videoIds, not indexes: indexes go stale after each removal
  let playingReason: { videoId: string; reason: string } | null = null;
  for (const item of items) {
    const info = queueItemInfo(item);
    if (!info) continue;
    const reason = reasonToSkip(
      info.videoId,
      info.channelIds,
      info.title,
      info.author,
    );
    if (!reason) continue;
    if (info.selected || info.videoId === currentId) {
      playingReason = { videoId: info.videoId, reason }; // never removed, skipped below
    } else if (!flagged.includes(info.videoId)) {
      flagged.push(info.videoId);
    }
  }

  // Skip the playing track only if it is still the one playing after the
  // removals have been applied by the store.
  const skipPlaying = () => {
    if (!active || !api || !playingReason) return;
    const nowId: string | undefined = api.getPlayerResponse?.()?.videoDetails
      ?.videoId;
    if (nowId === playingReason.videoId) {
      trySkip(playingReason.videoId, playingReason.reason);
    }
  };

  if (!flagged.length) {
    skipPlaying();
    return;
  }

  // Remove one track at a time. The index is read fresh each time, because the
  // queue changes after every removal. The playing track is never removed.
  removingFromQueue = true;
  let removed = 0;
  // One failed dispatch must not leave removingFromQueue stuck on true, which
  // would switch queue filtering off until the plugin is restarted.
  const step = () => {
    try {
      stepOnce();
    } catch (err) {
      console.warn('[skip-ai-slop] queue removal failed, stopping', err);
      removingFromQueue = false;
    }
  };
  const stepOnce = () => {
    const queueEl = document.querySelector<QueueEl>('#queue');
    if (!active || !api || !queueEl) {
      removingFromQueue = false;
      return;
    }
    const id = flagged.shift();
    if (!id) {
      removingFromQueue = false;
      if (removed) {
        console.info(`[skip-ai-slop] removed ${removed} flagged tracks from queue`);
      }
      setTimeout(skipPlaying, 200); // give the store time to apply the removals
      return;
    }
    const nowId: string | undefined = api.getPlayerResponse?.()?.videoDetails
      ?.videoId;
    const index = (queueEl.queue?.getItems?.() ?? []).findIndex(
      (it: any) => queueItemInfo(it)?.videoId === id,
    );
    if (index >= 0 && id !== nowId) {
      queueEl.dispatch({ type: 'REMOVE_ITEM', payload: index });
      removed++;
    }
    setTimeout(step, 50);
  };
  step();
};


// ---- autoplay pre-filter ----------------------------------------------------
// Autoplay ("automix") tracks arrive through the queue store as an
// ADD_AUTOMIX_ITEMS action. Wrapping the store's dispatch lets us drop flagged
// tracks before they ever enter the queue: no removal needed, no extra requests.
// UNVERIFIED: the exact payload shape; both an array and { items: [...] } are handled.
type StoreLike = {
  dispatch: (obj: { type: string; payload?: unknown }) => void;
  getState?: () => any;
};
let hookedStore: StoreLike | null = null;
let originalDispatch: StoreLike['dispatch'] | null = null;
let loggedAutomixShape = false;

const isFlaggedItem = (item: any) => {
  const info = queueItemInfo(item);
  return (
    !!info &&
    !!reasonToSkip(info.videoId, info.channelIds, info.title, info.author)
  );
};

const filterAutomixPayload = (payload: any) => {
  if (!loggedAutomixShape) {
    loggedAutomixShape = true;
    console.info(
      '[skip-ai-slop] ADD_AUTOMIX_ITEMS payload shape:',
      Array.isArray(payload) ? 'array' : Object.keys(payload ?? {}),
    );
  }
  const strip = (items: any[]) => items.filter((it) => !isFlaggedItem(it));
  let removed = 0;
  let out = payload;
  if (Array.isArray(payload)) {
    out = strip(payload);
    removed = payload.length - out.length;
  } else if (payload && Array.isArray(payload.automixItems)) {
    // the shape YouTube Music actually uses (seen in the log)
    const automixItems = strip(payload.automixItems);
    removed = payload.automixItems.length - automixItems.length;
    out = { ...payload, automixItems };
  } else if (payload && Array.isArray(payload.items)) {
    const items = strip(payload.items);
    removed = payload.items.length - items.length;
    out = { ...payload, items };
  }
  if (removed) {
    console.info(`[skip-ai-slop] dropped ${removed} flagged autoplay tracks`);
  }
  return out;
};

const hookStore = () => {
  if (hookedStore) return;
  const store = document.querySelector<QueueEl>('#queue') as any;
  const target: StoreLike | undefined = store?.queue?.store?.store;
  if (!target || typeof target.dispatch !== 'function') return;
  originalDispatch = target.dispatch;
  hookedStore = target;
  target.dispatch = function (this: unknown, event) {
    if (active && typeof event?.type === 'string' && event.type.includes('AUTOMIX')) {
      try {
        event = { ...event, payload: filterAutomixPayload(event.payload) };
      } catch (err) {
        console.warn('[skip-ai-slop] automix filter failed', err);
      }
    }
    return originalDispatch!.call(this, event);
  };
};

const unhookStore = () => {
  if (hookedStore && originalDispatch) hookedStore.dispatch = originalDispatch;
  hookedStore = null;
  originalDispatch = null;
};


// ---- page results filter (search, home, playlists, ...) --------------------------------------------------
// Hides flagged results/cards on every page. Everything is read from the data
// the page already holds in its result elements, so this costs no requests.
// UNVERIFIED: element/field names below come from YouTube Music's page structure.
// Every kind of result/card on any page (search, home, explore, library, artist,
// album, playlist, player "related" tabs), except the player queue, which is
// handled by scanQueue() and must keep its items.
const SEARCH_ITEMS = [
  'ytmusic-responsive-list-item-renderer',
  'ytmusic-two-row-item-renderer',
  'ytmusic-multi-row-list-item-renderer',
  'ytmusic-card-shelf-renderer',
]
  .map((tag) => `${tag}:not(ytmusic-player-queue *)`)
  .join(', ');
const HIDDEN_ATTR = 'data-skip-ai-slop';

type SearchInfo = {
  videoIds: string[];
  channelIds: string[];
  title: string;
  author: string;
  token: string | null; // "don't recommend" feedback token, if the card has one
};
const searchCache = new WeakMap<object, SearchInfo>();
let hiddenCount = 0;

const textOf = (runs: any): string =>
  Array.isArray(runs) ? runs.map((r) => r?.text ?? '').join('') : '';
const channelRuns = (runs: any): any[] =>
  (Array.isArray(runs) ? runs : []).filter((r) =>
    String(r?.navigationEndpoint?.browseEndpoint?.browseId ?? '').startsWith('UC'),
  );

const walkIds = (
  node: any,
  videoIds: Set<string>,
  channelIds: Set<string>,
  depth = 0,
) => {
  if (!node || typeof node !== 'object' || depth > 12) return;
  if (Array.isArray(node)) {
    for (const n of node) walkIds(n, videoIds, channelIds, depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string') {
      if (k === 'videoId') videoIds.add(v);
      else if (k === 'browseId' && v.startsWith('UC')) channelIds.add(v);
    } else {
      walkIds(v, videoIds, channelIds, depth + 1);
    }
  }
};

const searchInfo = (data: any): SearchInfo => {
  const cached = searchCache.get(data);
  if (cached) return cached;
  const videoIds = new Set<string>();
  const channelIds = new Set<string>();
  walkIds(data, videoIds, channelIds);

  let title = '';
  let author = '';
  const cols = data?.flexColumns;
  if (Array.isArray(cols)) {
    title = textOf(cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs);
    author = channelRuns(
      cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs,
    )
      .map((r) => r.text)
      .join(' ');
  } else {
    // top-result card, home/explore cards (two-row), multi-row items
    title =
      textOf(data?.header?.musicCardShelfHeaderBasicRenderer?.title?.runs) ||
      textOf(data?.title?.runs);
    author = channelRuns(data?.subtitle?.runs)
      .map((r) => r.text)
      .join(' ');
  }
  const info = {
    videoIds: [...videoIds],
    channelIds: [...channelIds],
    title,
    author,
    token: findNotInterestedToken(data),
  };
  searchCache.set(data, info);
  return info;
};

// ---- tell YouTube "not interested" (recommendation cards only) -------------
// Only cards whose own menu offers a "not interested" action (home / explore
// recommendations) are reported; nothing is sent for search or playlists.
// No request cap; queued reports are sent one after another, and each channel
// is reported at most once.
// UNVERIFIED: the menu field names and the /feedback request below.
const FEEDBACK_POLL_MS = 1000; // how often the queue is checked
const FEEDBACK_STORE_KEY = 'skip-ai-slop:feedback-done';
const NOT_INTERESTED_RE =
  /not interested|lgilenmiyorum|don'?t recommend|önerme/i;

let feedbackDone = new Set<string>(); // persisted: keys we already reported
let feedbackDoneLoaded = false;
const feedbackQueued = new Set<string>(); // this session: queued or tried
const feedbackQueue: {
  key: string;
  token: string;
  reason: string;
  name: string;
}[] = [];
let feedbackSent = 0;
let feedbackTimer: ReturnType<typeof setInterval> | null = null;
let loggedFeedbackMenu = false;

const loadFeedbackDone = () => {
  if (feedbackDoneLoaded) return;
  feedbackDoneLoaded = true;
  try {
    feedbackDone = new Set(
      JSON.parse(localStorage.getItem(FEEDBACK_STORE_KEY) ?? '[]'),
    );
  } catch {
    /* storage unavailable: just report from scratch */
  }
};
const saveFeedbackDone = () => {
  try {
    localStorage.setItem(
      FEEDBACK_STORE_KEY,
      JSON.stringify([...feedbackDone].slice(-2000)),
    );
  } catch {
    /* ignore */
  }
};

const findNotInterestedToken = (data: any): string | null => {
  const items = data?.menu?.menuRenderer?.items;
  if (!Array.isArray(items)) return null;
  if (!loggedFeedbackMenu) {
    loggedFeedbackMenu = true;
    console.info(
      '[skip-ai-slop] recommendation menu items:',
      items.map((it) => ({
        text: textOf(it?.menuServiceItemRenderer?.text?.runs),
        icon: it?.menuServiceItemRenderer?.icon?.iconType,
        hasToken:
          typeof it?.menuServiceItemRenderer?.serviceEndpoint?.feedbackEndpoint
            ?.feedbackToken === 'string',
      })),
    );
  }
  for (const it of items) {
    const r = it?.menuServiceItemRenderer;
    const token = r?.serviceEndpoint?.feedbackEndpoint?.feedbackToken;
    if (typeof token !== 'string') continue;
    if (
      NOT_INTERESTED_RE.test(textOf(r?.text?.runs)) ||
      /NOT_INTERESTED|DISMISS/i.test(String(r?.icon?.iconType ?? ''))
    ) {
      return token;
    }
  }
  return null;
};

// Cards' feedback tokens -> channel, so a manual "don't recommend artist" click
// (which YouTube sends through the app's fetch) can be recognised and that
// channel hidden everywhere, including "Listen again", which YouTube builds from
// history and does not clean up after "don't recommend".
const tokenChannel = new Map<string, { id: string; name: string }>();
type FetchFn = (url: string, data: any) => Promise<any>;
let hookedNetwork: { fetch: FetchFn } | null = null;
let originalFetch: FetchFn | null = null;

const onUserFeedback = (data: any) => {
  loadFeedbackDone();
  const tokens: unknown = data?.feedbackTokens;
  if (!Array.isArray(tokens)) return;
  for (const t of tokens) {
    const channel = typeof t === 'string' ? tokenChannel.get(t) : undefined;
    if (channel && !feedbackDone.has(channel.id)) {
      feedbackDone.add(channel.id);
      saveFeedbackDone();
      addBlocked(channel.id, channel.name);
      console.info(
        `[skip-ai-slop] "don't recommend" on ${channel.id}: hiding it everywhere`,
      );
      setTimeout(() => {
        scanSearchResults();
        scanQueue();
      }, 300);
    }
  }
};

const hookFetch = () => {
  if (hookedNetwork) return;
  const nm = document.querySelector<any>('ytmusic-app')?.networkManager;
  if (!nm || typeof nm.fetch !== 'function') return;
  originalFetch = nm.fetch;
  hookedNetwork = nm;
  nm.fetch = function (this: unknown, url: string, data: any) {
    try {
      if (active && typeof url === 'string' && url.includes('/feedback')) {
        onUserFeedback(data);
      }
    } catch (err) {
      console.warn('[skip-ai-slop] feedback hook failed', err);
    }
    return originalFetch!.call(this, url, data);
  };
};

const unhookFetch = () => {
  if (hookedNetwork && originalFetch) hookedNetwork.fetch = originalFetch;
  hookedNetwork = null;
  originalFetch = null;
};

// "Listen again" is built from listening history, so sending "not interested" for
// its cards would repeat on every start and does not remove them. Shelf titles
// are language dependent, so this lists the common ones.
const LISTEN_AGAIN_RE =
  /yeniden dinle|listen again|nochmal anh|écouter à nouveau|escuchar de nuevo|ascolta di nuovo|ouvir novamente|снова послушать/i;
const SHELF_SELECTOR =
  'ytmusic-carousel-shelf-renderer, ytmusic-shelf-renderer, ytmusic-immersive-carousel-shelf-renderer';

const isListenAgain = (el: HTMLElement): boolean => {
  const shelf = el.closest<HTMLElement>(SHELF_SELECTOR);
  if (!shelf) return false;
  const dataTitle = textOf(
    (shelf as any).data?.header?.musicCarouselShelfBasicHeaderRenderer?.title
      ?.runs,
  );
  if (dataTitle && LISTEN_AGAIN_RE.test(dataTitle)) return true;
  const header = shelf.querySelector(
    'ytmusic-carousel-shelf-basic-header-renderer, ytmusic-shelf-renderer #header, .header',
  );
  return !!header && LISTEN_AGAIN_RE.test(header.textContent ?? '');
};

const enqueueFeedback = (
  el: HTMLElement,
  info: SearchInfo,
  reason: string,
) => {
  if (isListenAgain(el)) return; // history shelf: hide locally only
  loadFeedbackDone();
  const token = info.token;
  if (!token) return; // not a recommendation card
  const key = info.channelIds[0] ?? info.videoIds[0] ?? token;
  if (feedbackDone.has(key) || feedbackQueued.has(key)) return;
  feedbackQueued.add(key);
  feedbackQueue.push({ key, token, reason, name: info.author || info.title });
};

let feedbackBusy = false;
const feedbackTick = async () => {
  if (feedbackBusy) return;
  feedbackBusy = true;
  try {
    while (active && config.reportFeedback && feedbackQueue.length) {
      const next = feedbackQueue.shift()!;
      const app = document.querySelector<any>('ytmusic-app');
      if (!app?.networkManager?.fetch) return;
      try {
        await (originalFetch ?? app.networkManager.fetch).call(
          app.networkManager,
          '/feedback?prettyPrint=false',
          { feedbackTokens: [next.token] },
        );
        feedbackSent++;
        feedbackDone.add(next.key);
        saveFeedbackDone();
        // the key falls back to a videoId/token when a card has no channel;
        // only real channel IDs belong in the channel block list
        if (next.key.startsWith('UC')) addBlocked(next.key, next.name);
        console.info(
          `[skip-ai-slop] sent "not interested" for ${next.key} (${next.reason})`,
        );
      } catch (err) {
        console.warn('[skip-ai-slop] feedback request failed', err);
      }
    }
  } finally {
    feedbackBusy = false;
  }
};

const unhideSearchResults = () => {
  for (const el of document.querySelectorAll<HTMLElement>(
    `[${HIDDEN_ATTR}], [${EARLY_ATTR}]`,
  )) {
    el.removeAttribute(HIDDEN_ATTR);
    el.removeAttribute(EARLY_ATTR);
    el.style.removeProperty('display');
  }
  hiddenCount = 0;
};

// Verdict per card. A card is judged once; every later scan reuses the answer
// until filterVersion changes, so scanning a page of hundreds of cards on each
// DOM change stays cheap.
const verdicts = new WeakMap<object, { ver: number; flagged: boolean }>();
let lastPageScan = 0;

const scanSearchResults = () => {
  if (!active) return;
  lastPageScan = performance.now();
  hookFetch();
  if (!config.hideInPages) {
    if (hiddenCount) unhideSearchResults();
    return;
  }
  const cards = document.querySelectorAll<HTMLElement>(SEARCH_ITEMS);
  // If cards were already on the page at the first scan, the plugin started
  // after the page drew them. That gap is what shows up as "slow".
  for (const el of cards) {
    const data = (el as any).data;
    let flagged = false;
    if (data && typeof data === 'object') {
      const info = searchInfo(data);
      if (info.token && info.channelIds[0] && !tokenChannel.has(info.token)) {
        tokenChannel.set(info.token, {
          id: info.channelIds[0],
          name: info.author || info.title,
        });
      }
      const cached = verdicts.get(data);
      if (cached && cached.ver === filterVersion) {
        flagged = cached.flagged;
      } else {
        const candidates = info.videoIds.length ? info.videoIds : [undefined];
        let reason: string | null = null;
        for (const v of candidates) {
          reason = reasonToSkip(v, info.channelIds, info.title, info.author);
          if (reason) break;
        }
        flagged = !!reason;
        verdicts.set(data, { ver: filterVersion, flagged });
        if (reason && config.reportFeedback) enqueueFeedback(el, info, reason);
      }
    }
    const isHidden = el.hasAttribute(HIDDEN_ATTR);
    // Hidden by the preload scanner (early.ts) from link text alone. Once the
    // card has real data the verdict above is authoritative: keep it hidden
    // (now counted as ours) or release it. Without data we cannot judge yet.
    const earlyHidden = el.hasAttribute(EARLY_ATTR);
    if (earlyHidden && data && typeof data === 'object') {
      el.removeAttribute(EARLY_ATTR);
      if (!flagged) el.style.removeProperty('display');
    }
    if (flagged && !isHidden) {
      el.setAttribute(HIDDEN_ATTR, '');
      el.style.display = 'none';
      hiddenCount++;
    } else if (!flagged && isHidden) {
      el.removeAttribute(HIDDEN_ATTR);
      el.style.removeProperty('display');
      hiddenCount = Math.max(0, hiddenCount - 1);
    }
  }
};

const skipped = new Set<string>(); // videoIds we already tried to skip (once each)

const trySkip = (videoId: string, reason: string) => {
  if (skipped.has(videoId)) return;
  skipped.add(videoId);
  if (!canSkipNow()) {
    console.warn('[skip-ai-slop] skip limit reached, not skipping', videoId);
    return;
  }
  recentSkips.push(Date.now());
  console.info(`[skip-ai-slop] skipping ${videoId} (${reason})`);
  api.nextVideo();
};

const check = () => {
  if (!active || !api) return;
  const details = api.getPlayerResponse?.()?.videoDetails;
  const videoId: string | undefined = details?.videoId;
  if (!videoId || !details?.title || videoId === lastCheckedId) return; // wait until the new track's data is complete
  lastCheckedId = videoId;
  skipped.delete(videoId); // a fresh arrival is always evaluated again

  // the queue entry carries the artist channel ids too, which can differ from
  // the uploader's channelId in videoDetails
  const queued = findQueueInfo(videoId);
  const channelIds = [details.channelId, ...(queued?.channelIds ?? [])].filter(
    Boolean,
  ) as string[];
  const reason = reasonToSkip(videoId, channelIds, details.title, details.author);
  if (!reason) return;

  // Flagged only by the uploader's channel: the queue entry's own (artist) channel
  // id is not on any list, so scanQueue could not remove this track ahead of time.
  // Block that artist id too, so their other queued tracks are removed instead of
  // skipped. scanQueue then removes them first and skips this one last.
  const artistId = queued?.channelIds.find((c) => c.startsWith('UC'));
  if (
    reason === 'channel' &&
    artistId &&
    !queued!.channelIds.some((c) => list && has(list.channels, c))
  ) {
    learnArtist(artistId);
    console.info(
      `[skip-ai-slop] learned artist ${artistId} (${queued!.author}), this session only`,
    );
    scanQueue();
    // fallback: if the same track is still playing shortly after, skip it
    setTimeout(() => {
      const nowId = api?.getPlayerResponse?.()?.videoDetails?.videoId;
      if (active && nowId === videoId) trySkip(videoId, reason);
    }, 600);
    return;
  }
  trySkip(videoId, reason);
};

const onVideoData = (e: Event) => {
  const name = (e as CustomEvent<{ name?: string }>).detail?.name;
  if (name === 'dataloaded' || name === 'dataupdated') {
    scanQueue();
    check();
  }
};

// Page scanning (search, home, lists) does not need the player API, so it starts
// with the plugin and reacts to DOM changes instead of waiting for a timer tick.
const PAGE_SCAN_MS = 1000;
const PAGE_SCAN_THROTTLE_MS = 80;
let pageObserver: MutationObserver | null = null;
let pageTimer: ReturnType<typeof setInterval> | null = null;
let pageScanPending = false;

// The first change after a quiet moment is scanned right away, inside the
// observer callback and so before the browser paints: a new card can be hidden
// before it is ever drawn. Changes that follow within the throttle window are
// scanned once, when the window ends.
const schedulePageScan = () => {
  if (pageScanPending) return;
  const wait = PAGE_SCAN_THROTTLE_MS - (performance.now() - lastPageScan);
  if (wait <= 0) {
    scanSearchResults();
    return;
  }
  pageScanPending = true;
  setTimeout(() => {
    pageScanPending = false;
    scanSearchResults();
  }, wait);
};

const startPageScan = () => {
  if (!pageObserver) {
    pageObserver = new MutationObserver(schedulePageScan);
    pageObserver.observe(document.body, { childList: true, subtree: true });
  }
  if (!pageTimer) pageTimer = setInterval(scanSearchResults, PAGE_SCAN_MS);
  if (!feedbackTimer) {
    feedbackTimer = setInterval(feedbackTick, FEEDBACK_POLL_MS);
  }
  // the renderer is watching the page now: tell the preload scanner to stand down
  document.documentElement.setAttribute(READY_ATTR, '');
  scanSearchResults();
};

const stopPageScan = () => {
  document.documentElement.removeAttribute(READY_ATTR);
  pageObserver?.disconnect();
  pageObserver = null;
  if (pageTimer) {
    clearInterval(pageTimer);
    pageTimer = null;
  }
  pageScanPending = false;
};

const attach = () => {
  if (!api || video) return;
  video = document.querySelector('video');
  // 'loadedmetadata' fires for every new track on the same <video> element.
  // 'durationchange' is a second chance in case player info updates slightly later;
  // the lastCheckedId guard in check() prevents double handling.
  video?.addEventListener('loadedmetadata', check);
  video?.addEventListener('durationchange', check);
  document.addEventListener('videodatachange', onVideoData);
  check();
  scanQueue();
  if (!queueTimer) queueTimer = setInterval(scanQueue, QUEUE_SCAN_MS);
};

const detach = () => {
  stopPageScan();
  unhookFetch();
  if (feedbackTimer) {
    clearInterval(feedbackTimer);
    feedbackTimer = null;
  }
  feedbackQueue.length = 0;
  unhookStore();
  unhideSearchResults();
  document.removeEventListener('videodatachange', onVideoData);
  skipped.clear();
  removingFromQueue = false;
  if (queueTimer) {
    clearInterval(queueTimer);
    queueTimer = null;
  }
  video?.removeEventListener('loadedmetadata', check);
  video?.removeEventListener('durationchange', check);
  video = null;
  lastCheckedId = null;
};

export default createPlugin({
  name: () => 'Skip AI Slop',
  restartNeeded: false,
  config: defaultConfig,
  settings: [
    {
      type: 'switch',
      key: 'hideInPages',
      label: () => 'Hide in pages',
      description: () =>
        'Hides AI slop tracks in search, home, explore, library and playlists',
    },
    {
      type: 'switch',
      key: 'reportFeedback',
      label: () => 'Send "Not interested" to YouTube for home recommendations',
      description: () =>
        'Sends permanent feedback to your YouTube account (slow and limited). Off by default',
    },
    {
      type: 'custom',
      key: 'keywords',
      label: () => 'Blocked keywords',
      description: () =>
        'Skips tracks whose title or channel name contains one of these words (whole words only)',
      component: 'skip-ai-slop.keywords',
    },
    {
      type: 'custom',
      key: 'userBlock',
      label: () => 'Blocked channels',
      description: () =>
        'Channels you marked "Don\'t recommend", plus ones the plugin reported to YouTube',
      component: 'skip-ai-slop.blocked',
    },
    {
      type: 'custom',
      key: 'recent',
      label: () => 'Recently filtered',
      description: () =>
        'Channels caught by a keyword or the community list. Press Allow if one is a false match',
      component: 'skip-ai-slop.recent',
    },
    {
      type: 'custom',
      key: 'userAllow',
      label: () => 'Allowed channels',
      description: () => 'Never filtered, no matter what',
      component: 'skip-ai-slop.allowed',
    },
    {
      type: 'custom',
      key: 'listTools',
      label: () => 'Community list',
      description: () =>
        'Download the list from GitHub again, or clear its saved copy',
      component: 'skip-ai-slop.tools',
    },
    {
      type: 'custom',
      key: 'searchBlocked',
      label: () => 'Search the community list',
      description: () =>
        'Find a channel or track on the community list by name or ID, and allow it',
      component: 'skip-ai-slop.search',
    },
  ],

  // Runs ~2 s before the renderer (measured): hides known-flagged cards before
  // the page has drawn them. See early.ts.
  preload: {
    start({ getConfig }) {
      return startEarlyScan(getConfig);
    },
    stop() {
      stopEarlyScan();
    },
  },

  renderer: {
    components: {
      keywords: KeywordList,
      blocked: BlockedList,
      recent: RecentList,
      allowed: AllowedList,
      search: SearchBlocked,
      tools: ListTools,
    },
    async start(context) {
      listenForListTools();
      savePluginConfig = context.setConfig;
      const cfg = await context.getConfig();
      config = { ...defaultConfig, ...cfg };
      rebuildKeywords();
      active = true;

      // The app starts renderer plugins one after another and waits for each
      // start() to finish, and it only hands out the player API once all of them
      // are done. So nothing slow may be awaited here: the saved list is read
      // synchronously from the cache, and a missing/expired one downloads in the
      // background and is applied when it arrives.
      const cacheFresh = loadCachedList();
      startPageScan(); // keywords, block/allow lists and the cached list work at once
      // also download once when the names for the settings search are missing
      if (!cacheFresh || !hasBlacklistNames()) {
        void downloadList().then((ok) => {
          if (ok) onListChanged();
        });
      }
      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = setInterval(refreshList, REFRESH_INTERVAL_MS);
      attach(); // no-op until onPlayerApiReady has provided the api
    },

    onPlayerApiReady(playerApi: any) {
      api = playerApi;
      if (active) attach();
    },

    onConfigChange(newConfig: Config) {
      config = { ...defaultConfig, ...newConfig };
      rebuildKeywords();
      lastCheckedId = null; // re-evaluate the currently playing track against the new config
      scanQueue();
      scanSearchResults();
      check(); // skip it now if the change just blocked it
    },

    stop() {
      active = false;
      stopListeningForListTools();
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
      recentSkips = [];
      sessionBlockIds = new Set();
      detach();
    },
  },
});
