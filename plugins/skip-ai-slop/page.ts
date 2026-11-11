import { type PageContextOf, type QueueAction, queueDispatch, queueItems, queueStore } from "@pear/sdk";
import { MAX_SKIPS, REFRESH_INTERVAL_MS, SKIP_WINDOW_MS, type SkipAiSlopConfig, type schema } from "./config.ts";
import type { SkipAiSlopCommands } from "./contract.ts";
import {
  EARLY_ATTR,
  HIDDEN_ATTR,
  HIDDEN_CLASS,
  PAGE_CARD_SELECTOR,
  PAGE_ROOT_SELECTOR,
  cardLinks,
  cardsInMutations,
  evaluateEarly,
  hideCard,
  unhideCard,
} from "./early.ts";
import {
  type Blacklist,
  type CardIdentity,
  type Rules,
  buildRules,
  decide,
  decideEarly,
  isBlacklist,
  matchedChannel,
  slimBlacklist,
} from "./filter.ts";
import { type ParsedQueueItem, type Renderer, type SearchInfo, parseQueueItem, rendererPath, searchInfo, textOf } from "./parse.ts";
import { createSkipLimiter } from "./skip-limit.ts";
import {
  type RecentEntry,
  clearPluginStorage,
  hasBlacklistNames,
  loadFeedbackDone,
  readCachedBlacklist,
  readRecentFiltered,
  recordFiltered,
  removeRecent as forgetRecent,
  saveFeedbackDone,
  searchBlacklistNames,
  writeBlacklistNames,
  writeCachedBlacklist,
} from "./storage.ts";

const PAGE_SCAN_MS = 3000;
const PAGE_SCAN_THROTTLE_MS = 80;
const QUEUE_SCAN_MS = 2000;
const FEEDBACK_POLL_MS = 1000;
const QUEUE_PARSE_CACHE_MAX = 500;

const SHELF_SELECTOR = "ytmusic-carousel-shelf-renderer, ytmusic-shelf-renderer, ytmusic-immersive-carousel-shelf-renderer";
/** "Listen again" is built from listening history and never cleans up, so it is hidden locally but never reported. */
const LISTEN_AGAIN_RE =
  /yeniden dinle|listen again|nochmal anh|écouter à nouveau|escuchar de nuevo|ascolta di nuovo|ouvrir novamente|снова послушать/i;

interface QueueItemInfo {
  videoId: string;
  selected: boolean;
  title: string;
  author: string;
  channelIds: string[];
}

interface StoreLike {
  dispatch(action: QueueAction): void;
}

/** The page's own InnerTube client; it carries the right context, cookies and key. */
type FetchFn = (url: string, data: unknown) => Promise<unknown>;

interface NetworkManager {
  fetch: FetchFn;
}

type AppElement = HTMLElement & { networkManager?: NetworkManager };

type Ctx = PageContextOf<typeof schema, SkipAiSlopCommands>;

export function startSkipAiSlop(ctx: Ctx) {
  let active = false;
  let config: SkipAiSlopConfig = { ...ctx.config };
  let list: Blacklist | null = null;
  const session = new Set<string>();
  let rules: Rules = buildRules(config, null, session);
  let filterVersion = 0;

  let lastCheckedId: string | null = null;
  const limiter = createSkipLimiter(MAX_SKIPS, SKIP_WINDOW_MS);

  let verdicts = new WeakMap<object, { version: number; flagged: boolean }>();
  let searchCache = new WeakMap<object, SearchInfo>();
  let queueParses = new Map<string, ParsedQueueItem>();
  let queueItemIds = new WeakMap<object, string>();
  let removingFromQueue = false;

  let hookedStore: StoreLike | null = null;
  let originalDispatch: StoreLike["dispatch"] | null = null;

  let hookedNetwork: NetworkManager | null = null;
  let originalFetch: FetchFn | null = null;
  /** "Don't recommend" token -> channel id, so the user's own click can block it too. */
  const tokenChannel = new Map<string, string>();

  let feedbackDone = new Set<string>();
  let feedbackDoneLoaded = false;
  const feedbackQueued = new Set<string>();
  const feedbackQueue: { key: string; token: string; reason: string }[] = [];
  let feedbackBusy = false;

  let lastPageScan = 0;
  let pageScanPending = false;

  const infoOf = (data: Renderer): SearchInfo => {
    let info = searchCache.get(data);
    if (!info) {
      info = searchInfo(data);
      searchCache.set(data, info);
    }
    return info;
  };

  const currentVideoId = (): string | undefined => {
    const track = ctx.player.state.track?.videoId;
    return track ?? ctx.player.api?.getPlayerResponse()?.videoDetails?.videoId;
  };

  function rebuild() {
    rules = buildRules(config, list, session);
    filterVersion++;
  }

  function loadCachedList(): boolean {
    const cached = readCachedBlacklist();
    if (!cached) return false;
    list = cached.data;
    return cached.fresh;
  }

  function listSummary() {
    if (!list) return ctx.t("plugins.skip-ai-slop.status.none", "No list loaded right now.");
    return ctx.t("plugins.skip-ai-slop.status.summary", "Loaded: {{channels}} channels, {{tracks}} tracks (list dated {{date}}).", {
      channels: Object.keys(list.channels).length,
      tracks: Object.keys(list.tracks).length,
      date: list.updated_at,
    });
  }

  async function downloadList(): Promise<boolean> {
    try {
      const data = await ctx.host.invoke("fetchList");
      if (!isBlacklist(data)) {
        ctx.log.warn("the community list is invalid or unsupported; keeping the old one");
        return false;
      }
      if (!active) return false;

      writeBlacklistNames(data);
      list = slimBlacklist(data);
      writeCachedBlacklist(list);
      return true;
    } catch (error) {
      ctx.log.warn("could not download the community list", error);
      return false;
    }
  }

  function onListChanged() {
    rebuild();
    lastCheckedId = null;
    unhideAll();
    scanPage();
    scanQueue();
    check();
  }

  async function refreshTick() {
    if (!active || !config.communityList) return;
    if (readCachedBlacklist()?.fresh) return;
    if (await downloadList()) onListChanged();
  }

  // ---- "not interested" feedback -------------------------------------------

  function isListenAgain(el: HTMLElement): boolean {
    const shelf = el.closest<HTMLElement>(SHELF_SELECTOR);
    if (!shelf) return false;

    const dataTitle = textOf(
      rendererPath((shelf as HTMLElement & { data?: unknown }).data, "header", "musicCarouselShelfBasicHeaderRenderer", "title")?.runs,
    );
    if (dataTitle && LISTEN_AGAIN_RE.test(dataTitle)) return true;

    const header = shelf.querySelector("ytmusic-carousel-shelf-basic-header-renderer, ytmusic-shelf-renderer #header, .header");
    return !!header && LISTEN_AGAIN_RE.test(header.textContent ?? "");
  }

  function enqueueFeedback(el: HTMLElement, info: SearchInfo, reason: string) {
    if (isListenAgain(el)) return;
    loadFeedback();
    const token = info.token;
    if (!token) return;

    const key = info.channelIds[0] ?? info.videoIds[0] ?? token;
    if (feedbackDone.has(key) || feedbackQueued.has(key)) return;
    feedbackQueued.add(key);
    feedbackQueue.push({ key, token, reason });
  }

  function loadFeedback() {
    if (feedbackDoneLoaded) return;
    feedbackDoneLoaded = true;
    feedbackDone = loadFeedbackDone();
  }

  function addBlocked(id: string) {
    if (rules.allowIds.has(id) || rules.blockIds.has(id) || ctx.config.userBlock.includes(id)) return;
    const userBlock = [...ctx.config.userBlock, id];
    ctx.setConfig({ userBlock });
    config = { ...config, userBlock };
    rules.blockIds.add(id);
    filterVersion++;
  }

  /** Allows one id (a channel, or a track's video id), dropping any block entry for it. */
  function allowId(id: string, name: string) {
    forgetRecent(id);
    const userAllow = ctx.config.userAllow.includes(id) ? ctx.config.userAllow : [...ctx.config.userAllow, id];
    const lowered = name.trim().toLowerCase();
    // Also drop the block entry with the same name: a channel can have a second
    // id (the community list's, or the one YTM shows).
    const userBlock = ctx.config.userBlock.filter((entry) => {
      const value = entry.trim().toLowerCase();
      return value !== id.toLowerCase() && value !== lowered;
    });
    if (userAllow === ctx.config.userAllow && userBlock.length === ctx.config.userBlock.length) return;
    ctx.setConfig({ userAllow, userBlock });
    config = { ...config, userAllow, userBlock };
    rebuild();
  }

  // The app's network manager, for the calls YTM itself makes ("Don't
  // recommend") and for sending our own feedback with the page's context.
  function hookFetch() {
    if (hookedNetwork) return;
    const network = ctx.$<AppElement>("app")?.networkManager;
    if (!network || typeof network.fetch !== "function") return;

    const original = network.fetch;
    originalFetch = original;
    hookedNetwork = network;
    network.fetch = function (this: unknown, url: string, data: unknown) {
      try {
        if (active && typeof url === "string" && url.includes("/feedback")) onUserFeedback(data);
      } catch (error) {
        ctx.log.warn("feedback hook failed", error);
      }
      return original.call(this, url, data);
    };
  }

  function unhookFetch() {
    if (hookedNetwork && originalFetch) hookedNetwork.fetch = originalFetch;
    hookedNetwork = null;
    originalFetch = null;
  }

  /**
   * The user clicked YTM's own "Don't recommend": block the channel here too, so
   * it disappears everywhere, including "Listen again" (which is rebuilt from
   * listening history and never cleans up).
   */
  function onUserFeedback(data: unknown) {
    const tokens = (data as { feedbackTokens?: unknown } | undefined)?.feedbackTokens;
    if (!Array.isArray(tokens)) return;
    loadFeedback();
    for (const token of tokens) {
      const channelId = typeof token === "string" ? tokenChannel.get(token) : undefined;
      if (!channelId || feedbackDone.has(channelId)) continue;
      feedbackDone.add(channelId);
      saveFeedbackDone(feedbackDone);
      addBlocked(channelId);
      ctx.log.info(`"don't recommend" on ${channelId}: hiding it everywhere`);
      // Re-judge what is on screen and in the queue once YTM applied the click.
      ctx.setTimeout(() => {
        scanPage();
        scanQueue();
      }, 300);
    }
  }

  function pageNetwork(): NetworkManager | null {
    return hookedNetwork ?? ctx.$<AppElement>("app")?.networkManager ?? null;
  }

  async function feedbackTick() {
    if (!active || !config.reportFeedback || feedbackBusy) return;
    feedbackBusy = true;
    try {
      while (active && config.reportFeedback && feedbackQueue.length > 0) {
        const next = feedbackQueue.shift();
        if (!next) break;

        const network = pageNetwork();
        if (!network) {
          // The page's client is not readable yet: keep the entry for the next tick.
          feedbackQueue.unshift(next);
          return;
        }

        try {
          // The page's own client carries the right context, cookies and key.
          const original = originalFetch ?? network.fetch;
          await original.call(network, "/feedback?prettyPrint=false", { feedbackTokens: [next.token] });
          if (!active) return;
          feedbackDone.add(next.key);
          saveFeedbackDone(feedbackDone);
          if (next.key.startsWith("UC")) addBlocked(next.key);
          ctx.log.info(`sent "not interested" for ${next.key} (${next.reason})`);
        } catch (error) {
          ctx.log.warn("feedback request failed", error);
        }
      }
    } finally {
      feedbackBusy = false;
    }
  }

  // ---- filtering decisions -------------------------------------------------

  function reasonToSkip(
    videoId: string | undefined,
    channelIds: readonly string[],
    title: string | undefined,
    author: string | undefined,
  ): string | null {
    const card: CardIdentity = { videoId, channelIds, title, author };
    const reason = decide(rules, card);
    if (reason && reason !== "user-block") {
      // Record the channel that actually matched, not the card's first one:
      // otherwise "Allow" in the settings could allow the wrong channel.
      const matched = reason === "channel" || reason === "learned-artist" ? matchedChannel(rules, channelIds) : undefined;
      const id = matched ?? channelIds[0];
      if (id) {
        const listedName = reason === "channel" && list ? list.channels[id]?.name : undefined;
        recordFiltered({ id, name: listedName || author || id, reason });
      }
    }
    return reason;
  }

  function learnArtist(id: string) {
    if (rules.allowIds.has(id) || rules.blockIds.has(id) || session.has(id)) return;
    session.add(id);
    filterVersion++;
  }

  function trySkip(videoId: string, reason: string) {
    // A rate-limited attempt is not recorded, so the queue scans retry it once
    // the skip window frees (pear-desktop 73617a95).
    if (!limiter.trySkip(videoId)) {
      if (!limiter.has(videoId)) ctx.log.warn("skip limit reached; not skipping", videoId);
      return;
    }
    ctx.log.info(`skipping ${videoId} (${reason})`);
    ctx.player.control({ type: "next" });
  }

  // ---- queue -----------------------------------------------------------------

  function queueItemInfo(item: unknown): QueueItemInfo | null {
    const key = item && typeof item === "object" ? (item as object) : null;
    const knownId = key ? queueItemIds.get(key) : undefined;
    const cached = knownId ? queueParses.get(knownId) : undefined;
    const parsed = cached?.item === key ? cached : parseQueueItem(item);
    if (!parsed) return null;

    if (key && parsed !== cached) {
      queueItemIds.set(key, parsed.videoId);
      // Delete first so the re-insert lands at the end: eviction stays oldest-first.
      queueParses.delete(parsed.videoId);
      queueParses.set(parsed.videoId, parsed);
      if (queueParses.size > QUEUE_PARSE_CACHE_MAX) {
        const oldest = queueParses.keys().next().value;
        if (oldest !== undefined) queueParses.delete(oldest);
      }
    }

    return {
      videoId: parsed.videoId,
      selected: !!parsed.renderer.selected,
      title: parsed.title,
      author: parsed.author,
      channelIds: parsed.channelIds,
    };
  }

  function findQueueInfo(videoId: string): QueueItemInfo | null {
    for (const item of queueItems()) {
      const info = queueItemInfo(item);
      if (info?.videoId === videoId) return info;
    }
    return null;
  }

  function scanQueue() {
    if (!active || removingFromQueue) return;
    hookStore();
    const items = queueItems();
    if (items.length === 0) return;

    const playingId = currentVideoId();
    const flagged: string[] = []; // video ids: indexes go stale after each removal
    let playingReason: { videoId: string; reason: string } | null = null;

    for (const item of items) {
      const info = queueItemInfo(item);
      if (!info) continue;
      const reason = reasonToSkip(info.videoId, info.channelIds, info.title, info.author);
      if (!reason) continue;

      if (info.selected || info.videoId === playingId) {
        playingReason = { videoId: info.videoId, reason }; // never removed, skipped below
      } else if (!flagged.includes(info.videoId)) {
        flagged.push(info.videoId);
      }
    }

    const playing = playingReason;
    const skipPlaying = () => {
      if (!active || !playing) return;
      if (currentVideoId() === playing.videoId) trySkip(playing.videoId, playing.reason);
    };

    if (flagged.length === 0) {
      skipPlaying();
      return;
    }

    // Remove one track at a time, reading the index fresh each time because the
    // queue changes after every removal. The playing track is never removed.
    removingFromQueue = true;
    let removed = 0;
    const step = () => {
      try {
        stepOnce();
      } catch (error) {
        ctx.log.warn("queue removal failed; stopping", error);
        removingFromQueue = false;
      }
    };
    const stepOnce = () => {
      if (!active) {
        removingFromQueue = false;
        return;
      }
      const id = flagged.shift();
      if (!id) {
        removingFromQueue = false;
        if (removed > 0) ctx.log.info(`removed ${removed} flagged track(s) from the queue`);
        ctx.setTimeout(skipPlaying, 200); // give the store time to apply the removals
        return;
      }

      const nowId = currentVideoId();
      const index = queueItems().findIndex((item) => queueItemInfo(item)?.videoId === id);
      if (index >= 0 && id !== nowId) {
        queueDispatch({ type: "REMOVE_ITEM", payload: index });
        removed++;
      }
      ctx.setTimeout(step, 50);
    };
    step();
  }

  // ---- autoplay pre-filter ---------------------------------------------------

  function isFlaggedItem(item: unknown): boolean {
    const info = queueItemInfo(item);
    return !!info && !!reasonToSkip(info.videoId, info.channelIds, info.title, info.author);
  }

  function filterAutomixPayload(payload: unknown): unknown {
    const strip = (items: unknown[]) => items.filter((item) => !isFlaggedItem(item));
    let removed = 0;
    let filtered: unknown = payload;

    if (Array.isArray(payload)) {
      const kept = strip(payload);
      removed = payload.length - kept.length;
      filtered = kept;
    } else if (payload && typeof payload === "object") {
      const record = payload as Record<string, unknown>;
      const automix = record.automixItems;
      const items = record.items;
      if (Array.isArray(automix)) {
        const kept = strip(automix);
        removed = automix.length - kept.length;
        filtered = { ...record, automixItems: kept };
      } else if (Array.isArray(items)) {
        const kept = strip(items);
        removed = items.length - kept.length;
        filtered = { ...record, items: kept };
      }
    }

    if (removed > 0) ctx.log.info(`dropped ${removed} flagged autoplay track(s)`);
    return filtered;
  }

  function hookStore() {
    const store = queueStore()?.store?.store;
    if (!store || typeof store.dispatch !== "function" || hookedStore === (store as StoreLike)) return;
    if (hookedStore) unhookStore();

    const dispatch = store.dispatch;
    originalDispatch = dispatch;
    hookedStore = store;
    store.dispatch = function (this: unknown, action: QueueAction) {
      if (active && typeof action?.type === "string" && action.type.includes("AUTOMIX")) {
        try {
          action = { ...action, payload: filterAutomixPayload(action.payload) };
        } catch (error) {
          ctx.log.warn("automix filter failed", error);
        }
      }
      dispatch.call(this, action);
    };
  }

  function unhookStore() {
    if (hookedStore && originalDispatch) hookedStore.dispatch = originalDispatch;
    hookedStore = null;
    originalDispatch = null;
  }

  // ---- page cards ------------------------------------------------------------

  function unhideAll() {
    for (const card of document.querySelectorAll<HTMLElement>(`[${EARLY_ATTR}], [${HIDDEN_ATTR}], .${HIDDEN_CLASS}`)) {
      unhideCard(card);
    }
  }

  function scanPage() {
    if (!active) return;
    lastPageScan = performance.now();
    hookFetch();
    if (!config.hideInPages) {
      unhideAll();
      return;
    }

    // Scoped to the content panel for cheapness, but fall back to the document
    // when the layout differs or is not built yet.
    const root: ParentNode = document.querySelector<HTMLElement>(PAGE_ROOT_SELECTOR) ?? document;
    for (const card of root.querySelectorAll<HTMLElement>(PAGE_CARD_SELECTOR)) {
      const raw = (card as HTMLElement & { data?: unknown }).data;
      const data = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Renderer) : undefined;

      if (!data) {
        // Links may not be drawn yet: keep or release the early verdict, and
        // judge again on a later mutation.
        const earlyHidden = card.hasAttribute(EARLY_ATTR);
        const early = decideEarly(rules, cardLinks(card));
        if (early && !earlyHidden && !card.hasAttribute(HIDDEN_ATTR)) hideCard(card, EARLY_ATTR);
        else if (!early && earlyHidden) unhideCard(card);
        continue;
      }

      const info = infoOf(data);
      // Remember which channel a card's "Don't recommend" token belongs to, so
      // the user's own menu click can block it (see onUserFeedback).
      if (info.token && info.channelIds[0] && !tokenChannel.has(info.token)) tokenChannel.set(info.token, info.channelIds[0]);

      const cached = verdicts.get(data);
      let flagged: boolean;
      if (cached && cached.version === filterVersion) {
        flagged = cached.flagged;
      } else {
        let reason: string | null = null;
        const candidates: (string | undefined)[] = info.videoIds.length > 0 ? info.videoIds : [undefined];
        for (const videoId of candidates) {
          reason = reasonToSkip(videoId, info.channelIds, info.title, info.author);
          if (reason) break;
        }
        flagged = !!reason;
        verdicts.set(data, { version: filterVersion, flagged });
        if (reason && config.reportFeedback) enqueueFeedback(card, info, reason);
      }

      card.removeAttribute(EARLY_ATTR);
      if (flagged) hideCard(card, HIDDEN_ATTR);
      else unhideCard(card);
    }
  }

  function schedulePageScan() {
    if (!active || pageScanPending) return;
    const wait = PAGE_SCAN_THROTTLE_MS - (performance.now() - lastPageScan);
    if (wait <= 0) {
      scanPage();
      return;
    }
    pageScanPending = true;
    ctx.setTimeout(() => {
      pageScanPending = false;
      scanPage();
    }, wait);
  }

  // ---- playback checks -------------------------------------------------------

  function check() {
    if (!active) return;

    const details = ctx.player.api?.getPlayerResponse()?.videoDetails as
      | { videoId?: string; title?: string; author?: string; channelId?: string }
      | undefined;
    const track = ctx.player.state.track;
    const videoId = track?.videoId ?? details?.videoId;
    const title = track?.title ?? details?.title;
    const author = track?.artist ?? details?.author;
    if (!videoId || !title || videoId === lastCheckedId) return; // wait until the new track's data is complete

    lastCheckedId = videoId;
    limiter.reset(videoId);

    // The queue entry carries the artist channel ids too, which can differ from
    // the uploader's channelId in the player response. A stale response belongs
    // to the previous track, so its uploader id is not used.
    const queued = findQueueInfo(videoId);
    const uploaderId = details?.videoId === videoId ? details?.channelId : undefined;
    const channelIds = [uploaderId, ...(queued?.channelIds ?? [])].filter((id): id is string => typeof id === "string" && id.length > 0);
    const reason = reasonToSkip(videoId, channelIds, title, author);
    if (!reason) return;

    // Flagged only by the uploader's channel: the queue entry's artist id is on
    // no list, so scanQueue could not remove this track ahead of time. Learn that
    // artist too, so their other queued tracks get removed and this one is
    // skipped last.
    const artistId = queued?.channelIds.find((id) => id.startsWith("UC"));
    const communityChannels = list?.channels;
    if (reason === "channel" && artistId && !queued?.channelIds.some((id) => !!communityChannels && Object.hasOwn(communityChannels, id))) {
      learnArtist(artistId);
      ctx.log.info(`learned artist ${artistId} (${queued?.author ?? author}), this session only`);
      scanQueue();
      // Fallback: if the same track is still playing shortly after, skip it.
      ctx.setTimeout(() => {
        if (active && currentVideoId() === videoId) trySkip(videoId, reason);
      }, 600);
      return;
    }

    trySkip(videoId, reason);
  }

  // ---- settings actions, answered for the host --------------------------------

  /** Recent matches the block/allow lists do not handle yet, newest first. */
  function pendingRecent(): RecentEntry[] {
    const handled = new Set([...ctx.config.userBlock, ...ctx.config.userAllow].map((value) => value.trim().toLowerCase()));
    return readRecentFiltered().filter((entry) => !handled.has(entry.id.toLowerCase()) && !handled.has(entry.name.trim().toLowerCase()));
  }

  /** The entry an action works on: the id given, or else the newest pending one. */
  function recentEntry(id: string | undefined): RecentEntry | undefined {
    return id ? readRecentFiltered().find((entry) => entry.id === id) : pendingRecent()[0];
  }

  function recentSummary(): string {
    const recent = pendingRecent();
    if (recent.length === 0) return ctx.t("plugins.skip-ai-slop.status.recent-none", "Nothing has been filtered yet.");
    // The status line is the only place the settings card can show the id, and a
    // pasted id is what makes "Allow" match a channel for sure.
    const entries = recent
      .slice(0, 8)
      .map((entry) => `${entry.name} (${entry.reason}) — ${entry.id}`)
      .join(" · ");
    return ctx.t("plugins.skip-ai-slop.status.recent", "Recently filtered ({{count}}): {{entries}}", { count: recent.length, entries });
  }

  function allowRecent(id: string | undefined): string {
    const entry = recentEntry(id);
    if (!entry) {
      return id
        ? ctx.t("plugins.skip-ai-slop.status.recent-unknown", "“{{id}}” is not in the recently filtered list.", { id })
        : ctx.t("plugins.skip-ai-slop.status.recent-none", "Nothing has been filtered yet.");
    }
    allowId(entry.id, entry.name);
    ctx.log.info(`allowed ${entry.id} (${entry.name}) from the recently filtered list`);
    return ctx.t("plugins.skip-ai-slop.status.recent-allowed", "Allowed {{name}} ({{id}}); it will not be filtered again.", {
      name: entry.name,
      id: entry.id,
    });
  }

  function removeRecentEntry(id: string | undefined): string {
    const entry = recentEntry(id);
    if (!entry) {
      return id
        ? ctx.t("plugins.skip-ai-slop.status.recent-unknown", "“{{id}}” is not in the recently filtered list.", { id })
        : ctx.t("plugins.skip-ai-slop.status.recent-none", "Nothing has been filtered yet.");
    }
    forgetRecent(entry.id);
    return ctx.t("plugins.skip-ai-slop.status.recent-removed", "Forgot {{name}} ({{id}}) from the recently filtered list.", {
      name: entry.name,
      id: entry.id,
    });
  }

  function kindLabel(kind: "channel" | "track") {
    return kind === "channel"
      ? ctx.t("plugins.skip-ai-slop.status.channel", "channel")
      : ctx.t("plugins.skip-ai-slop.status.track", "track");
  }

  function listSearchSummary(): string {
    const query = ctx.config.listSearch.trim();
    if (!query) return ctx.t("plugins.skip-ai-slop.status.search-no-query", "Set “Community list search” in the settings first.");
    if (!hasBlacklistNames())
      return ctx.t("plugins.skip-ai-slop.status.search-no-names", "The list's names are not saved yet; download the list first.");

    const { matches, total } = searchBlacklistNames(query);
    if (matches.length === 0)
      return ctx.t("plugins.skip-ai-slop.status.search-none", "No community-list matches for “{{query}}”.", { query });
    const entries = matches.map((entry) => `${entry.name} (${kindLabel(entry.kind)}, ${entry.id})`).join(" · ");
    return ctx.t("plugins.skip-ai-slop.status.search-matches", "Matches for “{{query}}” ({{total}}): {{entries}}", {
      query,
      total,
      entries: total > matches.length ? `${entries} …` : entries,
    });
  }

  function allowListMatch(): string {
    const query = ctx.config.listSearch.trim();
    if (!query) return ctx.t("plugins.skip-ai-slop.status.search-no-query", "Set “Community list search” in the settings first.");
    if (!hasBlacklistNames())
      return ctx.t("plugins.skip-ai-slop.status.search-no-names", "The list's names are not saved yet; download the list first.");

    // The name-prefix matches come first, so the best match is the one to allow.
    const { matches, total } = searchBlacklistNames(query, 1);
    const entry = matches[0];
    if (!entry) return ctx.t("plugins.skip-ai-slop.status.search-none", "No community-list matches for “{{query}}”.", { query });
    allowId(entry.id, entry.name);
    ctx.log.info(`allowed ${entry.id} (${entry.name}) from the community list`);

    const vars = { name: entry.name, kind: kindLabel(entry.kind), id: entry.id };
    if (total > 1) {
      return ctx.t(
        "plugins.skip-ai-slop.status.search-allowed-more",
        "Allowed {{name}} ({{kind}}, {{id}}). {{remaining}} other matches remain; narrow the search to pick one.",
        { ...vars, remaining: total - 1 },
      );
    }
    return ctx.t("plugins.skip-ai-slop.status.search-allowed", "Allowed {{name}} ({{kind}}, {{id}}).", vars);
  }

  // ---- start -----------------------------------------------------------------

  active = true;
  loadFeedback();

  if (config.communityList) loadCachedList();
  rebuild();

  ctx.host.handle("refreshList", async () => {
    ctx.log.info("refreshing the community list");
    const ok = await downloadList();
    if (ok && active) onListChanged();
    return ok
      ? ctx.t("plugins.skip-ai-slop.status.downloaded", "Downloaded. {{summary}}", { summary: listSummary() })
      : ctx.t("plugins.skip-ai-slop.status.download-failed", "Download failed, the old list was kept (details in the console).");
  });

  ctx.host.handle("clearCache", () => {
    clearPluginStorage();
    list = null;
    feedbackDone = new Set();
    feedbackDoneLoaded = true;
    feedbackQueued.clear();
    feedbackQueue.length = 0;
    session.clear();
    limiter.clear();
    tokenChannel.clear();
    rebuild();
    lastCheckedId = null;
    unhideAll();
    scanPage();
    scanQueue();
    check();
    return ctx.t(
      "plugins.skip-ai-slop.status.cache-cleared",
      'Cache cleared. The community list is off until you press "Download list now" (or restart the app).',
    );
  });

  ctx.host.handle("showRecent", recentSummary);
  ctx.host.handle("allowRecent", (payload) => allowRecent(typeof payload === "string" ? payload : undefined));
  ctx.host.handle("removeRecent", (payload) => removeRecentEntry(typeof payload === "string" ? payload : undefined));
  ctx.host.handle("searchList", listSearchSummary);
  ctx.host.handle("allowListMatch", allowListMatch);

  // Pre-paint scan, installed before YTM's scripts (runAt: "start").
  ctx.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] }, (records) => {
    if (!active) return;
    if (config.hideInPages) {
      for (const card of cardsInMutations(records)) evaluateEarly(card, rules);
    }
    schedulePageScan();
  });

  ctx.player.on("trackChange", () => {
    scanQueue();
    check();
  });
  ctx.player.on("change", check);

  scanPage();
  scanQueue();
  check();

  ctx.setInterval(scanPage, PAGE_SCAN_MS);
  ctx.setInterval(scanQueue, QUEUE_SCAN_MS);
  ctx.setInterval(() => void feedbackTick(), FEEDBACK_POLL_MS);
  ctx.setInterval(() => void refreshTick(), REFRESH_INTERVAL_MS);

  // The saved list is read synchronously; a missing or stale one downloads in
  // the background and is applied when it arrives.
  if (config.communityList && (!readCachedBlacklist()?.fresh || !hasBlacklistNames())) {
    void downloadList().then((ok) => {
      if (ok && active) onListChanged();
    });
  }

  ctx.onConfigChange((next) => {
    config = { ...next };
    if (config.communityList && !list) loadCachedList();
    rebuild();
    lastCheckedId = null;
    if (!config.hideInPages) unhideAll();
    scanPage();
    scanQueue();
    check();
    if (config.communityList && (!readCachedBlacklist()?.fresh || !hasBlacklistNames())) {
      void downloadList().then((ok) => {
        if (ok && active) onListChanged();
      });
    }
  });

  return () => {
    active = false;
    pageScanPending = false;
    unhookStore();
    unhookFetch();
    unhideAll();
    limiter.clear();
    session.clear();
    tokenChannel.clear();
    removingFromQueue = false;
    feedbackBusy = false;
    feedbackQueue.length = 0;
    feedbackQueued.clear();
    verdicts = new WeakMap<object, { version: number; flagged: boolean }>();
    searchCache = new WeakMap<object, SearchInfo>();
    queueParses = new Map<string, ParsedQueueItem>();
    queueItemIds = new WeakMap<object, string>();
    list = null;
    lastCheckedId = null;
  };
}
