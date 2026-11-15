// Pre-paint card hiding. The page part starts before YTM's scripts
// (runAt: "start"), so this runs inside the mutation observer callback, before
// the browser paints an inserted card. The full scan later replaces these
// link-only verdicts with the card's real page data.

import { type CardLinks, type Rules, decideEarly } from "./filter.ts";

export const EARLY_ATTR = "data-pear-skip-ai-slop-early";
export const HIDDEN_ATTR = "data-pear-skip-ai-slop-hidden";
export const HIDDEN_CLASS = "pear-skip-ai-slop-hidden";

/** Search/list rows YTM draws before their data is attached. */
export const CARD_SELECTOR = [
  "ytmusic-two-row-item-renderer",
  "ytmusic-multi-row-list-item-renderer",
  "ytmusic-responsive-list-item-renderer",
]
  .map((tag) => `${tag}:not(ytmusic-player-queue *)`)
  .join(", ");

/** The full scan also reads the card shelf YTM uses for top results. */
export const PAGE_CARD_SELECTOR = [
  "ytmusic-two-row-item-renderer",
  "ytmusic-multi-row-list-item-renderer",
  "ytmusic-responsive-list-item-renderer",
  "ytmusic-card-shelf-renderer",
]
  .map((tag) => `${tag}:not(ytmusic-player-queue *)`)
  .join(", ");

/** The content panel every page's cards are inserted into. */
export const PAGE_ROOT_SELECTOR = "ytmusic-app-layout > #content";

export const HIDDEN_CSS = `.${HIDDEN_CLASS} { display: none !important; }`;

const CHANNEL_RE = /(?:^|[/=])(UC[\w-]{22})(?![\w-])/;
const VIDEO_RE = /[?&]v=([\w-]{11})/;

/** The ids and visible texts a card's links currently carry. */
export const cardLinks = (card: Element): CardLinks => {
  const videoIds = new Set<string>();
  const channelIds = new Set<string>();
  const texts = new Set<string>();

  for (const anchor of card.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href") ?? "";
    const channel = CHANNEL_RE.exec(href);
    if (channel?.[1]) channelIds.add(channel[1]);
    const video = VIDEO_RE.exec(href);
    if (video?.[1]) videoIds.add(video[1]);
    const text = anchor.textContent?.trim();
    if (text) texts.add(text);
  }

  return { videoIds: [...videoIds], channelIds: [...channelIds], texts: [...texts] };
};

export const hideCard = (card: Element, attribute: string) => {
  card.setAttribute(attribute, "");
  card.classList.add(HIDDEN_CLASS);
};

export const unhideCard = (card: Element) => {
  card.removeAttribute(EARLY_ATTR);
  card.removeAttribute(HIDDEN_ATTR);
  card.classList.remove(HIDDEN_CLASS);
};

/** Hides the card from its links alone when it already matches. */
export const evaluateEarly = (card: Element, rules: Rules): boolean => {
  if (card.hasAttribute(EARLY_ATTR) || card.hasAttribute(HIDDEN_ATTR)) return false;
  if (!decideEarly(rules, cardLinks(card))) return false;
  hideCard(card, EARLY_ATTR);
  return true;
};

/** Every card touched by a batch of mutations, so it can be judged before paint. */
export const cardsInMutations = (records: readonly MutationRecord[]): Set<Element> => {
  const cards = new Set<Element>();
  const collect = (node: Node) => {
    if (!(node instanceof Element)) return;
    const own = node.closest(CARD_SELECTOR);
    if (own) cards.add(own);
    else node.querySelectorAll(CARD_SELECTOR).forEach((card) => cards.add(card));
  };
  for (const record of records) {
    if (record.type === "attributes") collect(record.target);
    else record.addedNodes.forEach(collect);
  }
  return cards;
};
