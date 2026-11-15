// TTML parser for the Apple-format lyrics lrc.red serves: `ttm:agent` singers,
// word/syllable `<span begin end>` timings, `ttm:role="x-bg"` background vocals,
// `dir="rtl"` lines and `<ttm:translation>` entries. Providers run in the main
// process, where there is no DOMParser, so xmldom supplies one.

import { DOMParser } from "@xmldom/xmldom";
import type { LyricWord } from "./types.ts";

const TTM_NS = "http://www.w3.org/ns/ttml#metadata";
const LRC_NS = "http://lrc.red/lyric-ttml-internal";
const ITUNES_NS = "http://music.apple.com/lyrics";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

/** `<p>` line with word/syllable timings resolved from its `<span>`s. */
export interface TTMLParsedLine {
  startMs: number;
  endMs: number;
  text: string;
  words: LyricWord[];
  /** Background vocals sung over this line, when the provider has them. */
  background: LyricWord[];
  alignment?: "start" | "end";
  rtl?: boolean;
  /** `<p lrc:key>`/`itunes:key`, used to attach TTML translations. */
  key?: string;
}

export interface TTMLParseResult {
  lines: TTMLParsedLine[];
  /** `<ttm:translation>` entries by line key. */
  translations: Record<string, string>;
  translationLanguage?: string;
}

const RTL_LANGUAGES = new Set(["ar", "dv", "fa", "he", "ku", "ps", "ur", "yi"]);

const localName = (element: Element) => (element.localName ?? element.nodeName).toLowerCase();

const elementsWithName = (root: Document | Element, name: string) =>
  Array.from(root.getElementsByTagName("*")).filter((element) => localName(element) === name);

/** Namespaced attribute lookup that also works when the parser keeps only the prefixed name. */
const attr = (element: Element, name: string, namespace: string, prefix: string): string | null =>
  element.getAttributeNS(namespace, name) ?? element.getAttribute(`${prefix}:${name}`) ?? element.getAttribute(name);

const roleOf = (element: Element) => attr(element, "role", TTM_NS, "ttm");

const isBackground = (element: Element) => roleOf(element) === "x-bg";

/**
 * TTML times: `hh:mm:ss.mmm`, `mm:ss.mmm`, bare seconds and the unit-suffixed
 * `500ms`/`1.5s`/`2m`/`1h` forms.
 */
export function parseTTMLTime(value: string | null, fallback = 0): number {
  if (!value) return fallback;

  const normalized = value.trim().toLowerCase();
  const unitMatch = normalized.match(/^(-?\d+(?:\.\d+)?)(ms|h|m|s)$/);
  if (unitMatch) {
    const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
    return Math.max(0, Math.round(Number(unitMatch[1]) * multipliers[unitMatch[2]!]!));
  }

  const parts = normalized.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return fallback;

  const seconds =
    parts.length === 3
      ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
      : parts.length === 2
        ? parts[0]! * 60 + parts[1]!
        : parts.length === 1
          ? parts[0]!
          : Number.NaN;

  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : fallback;
}

/**
 * The text of one timed span plus the whitespace that follows it. TTML keeps
 * the spaces between spans in text nodes, so they have to be re-attached or the
 * words render run together.
 */
function spanText(span: Element): string {
  let text = span.textContent ?? "";
  const next = span.nextSibling;
  if (next?.nodeType === 3 && /^\s/.test(next.textContent ?? "") && !/\s$/.test(text)) text += " ";
  return text;
}

/** True when a timed span wraps more finely timed spans (keep the leaves). */
const hasTimedSpanDescendant = (span: Element) => elementsWithName(span, "span").some((child) => child.hasAttribute("begin"));

const isInsideBackground = (span: Element, root: Element) => {
  let parent = span.parentElement;
  while (parent && parent !== root) {
    if (isBackground(parent)) return true;
    parent = parent.parentElement;
  }
  return false;
};

/** Timed leaf spans of a `<p>`, split into main and background vocals. */
function collectWords(p: Element): { words: LyricWord[]; background: LyricWord[] } {
  const words: LyricWord[] = [];
  const background: LyricWord[] = [];

  for (const span of elementsWithName(p, "span")) {
    if (!span.hasAttribute("begin") || hasTimedSpanDescendant(span)) continue;

    const startMs = parseTTMLTime(span.getAttribute("begin"));
    const endMs = parseTTMLTime(span.getAttribute("end"), startMs);
    const text = spanText(span);
    if (!text.trim()) continue;

    (isInsideBackground(span, p) ? background : words).push({ text, startMs, endMs });
  }

  return { words, background };
}

/** `<p>` text with the background-vocal spans removed. */
const lineText = (p: Element) =>
  Array.from(p.childNodes)
    .filter((node) => !(node.nodeType === 1 && isBackground(node as Element)))
    .map((node) => node.textContent ?? "")
    .join("");

const languageOf = (element: Element | null): string | undefined =>
  element?.getAttributeNS(XML_NS, "lang") ?? element?.getAttribute("xml:lang") ?? element?.getAttribute("lang") ?? undefined;

/**
 * Duet alignment: with more than one person agent, singers alternate which
 * side of the screen their lines are shown on. Groups stay on the left.
 */
function assignAlignments(lines: TTMLParsedLine[], agentTypes: Map<string, string>, lineAgents: (string | undefined)[]) {
  const personAgents = [...new Set(lineAgents.filter((agent): agent is string => Boolean(agent) && agentTypes.get(agent!) !== "group"))];
  if (personAgents.length < 2) return;

  const sides = new Map<string, "start" | "end">();
  // A synthesised duet types its right-hand agent `other`, so a song that opens
  // on the right keeps that side regardless of which agent appears first.
  for (const agent of personAgents) if (agentTypes.get(agent) === "other") sides.set(agent, "end");
  let nextSide: "start" | "end" = "start";
  for (const agent of personAgents) {
    if (sides.has(agent)) continue;
    sides.set(agent, nextSide);
    nextSide = nextSide === "start" ? "end" : "start";
  }

  lines.forEach((line, index) => {
    const agent = lineAgents[index];
    const side = agent ? sides.get(agent) : undefined;
    if (side) line.alignment = side;
  });
}

/**
 * A word is sung until the earlier of its own `<span end>` and the next word:
 * the span end keeps the karaoke fill from bleeding into a gap after the word.
 */
function fillWordDurations(words: LyricWord[], lineEnd: number) {
  words.forEach((word, index) => {
    const next = words[index + 1];
    const explicitEnd = word.endMs > word.startMs ? word.endMs : Number.POSITIVE_INFINITY;
    const availableEnd = next ? next.startMs : lineEnd;
    word.endMs = Math.max(word.startMs, Math.min(availableEnd, explicitEnd));
  });
}

/**
 * Parses Apple-format TTML (what lrc.red serves). Returns null when the payload
 * is not usable TTML.
 */
export function parseTTML(ttml: string): TTMLParseResult | null {
  if (!ttml.trim()) return null;

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(ttml, "text/xml") as unknown as Document;
  } catch {
    return null;
  }

  const root = doc.documentElement;
  if (!root || localName(root) === "parsererror") return null;

  const language = languageOf(root);
  const primaryLanguage = language?.toLowerCase().split(/[-_]/)[0];

  const agentTypes = new Map<string, string>();
  for (const agent of elementsWithName(doc, "agent")) {
    const id = attr(agent, "id", XML_NS, "xml");
    const type = agent.getAttribute("type");
    if (id && type) agentTypes.set(id, type);
  }

  const translations: Record<string, string> = {};
  let translationLanguage: string | undefined;
  for (const translation of elementsWithName(doc, "translation")) {
    const translationLang = languageOf(translation);
    const isSameLanguage = translationLang && primaryLanguage && translationLang.toLowerCase().split(/[-_]/)[0] === primaryLanguage;
    // Prefer a translation in another language; a same-language entry is usually
    // a romanization and reads better in the translation slot only as fallback.
    if (isSameLanguage) continue;

    for (const text of elementsWithName(translation, "text")) {
      const key = text.getAttribute("for");
      const value = text.textContent?.trim();
      if (!key || !value) continue;
      translations[key] = value;
      translationLanguage ??= translationLang;
    }
  }

  const lines: TTMLParsedLine[] = [];
  const lineAgents: (string | undefined)[] = [];

  for (const p of elementsWithName(doc, "p")) {
    const startMs = parseTTMLTime(p.getAttribute("begin"));
    const declaredEnd = parseTTMLTime(p.getAttribute("end"), startMs);
    const { words, background } = collectWords(p);
    const key = attr(p, "key", LRC_NS, "lrc") ?? attr(p, "key", ITUNES_NS, "itunes") ?? undefined;
    const agent = attr(p, "agent", TTM_NS, "ttm") ?? undefined;
    const pLanguage = languageOf(p) ?? language;

    const content = lineText(p).trim();
    const text = words.length
      ? words
          .map((word) => word.text)
          .join("")
          .trim()
      : content;
    const rtl = p.getAttribute("dir") === "rtl" || Boolean(pLanguage && RTL_LANGUAGES.has(pLanguage.toLowerCase().split(/[-_]/)[0]!));

    lines.push({
      startMs,
      endMs: declaredEnd,
      text,
      words,
      background,
      ...(key ? { key } : {}),
      ...(rtl ? { rtl: true } : {}),
    });
    lineAgents.push(agent);
  }

  if (!lines.length) return null;

  const sorted = lines.map((line, index) => ({ line, agent: lineAgents[index] })).sort((a, b) => a.line.startMs - b.line.startMs);
  const orderedLines = sorted.map((entry) => entry.line);
  const orderedAgents = sorted.map((entry) => entry.agent);

  assignAlignments(orderedLines, agentTypes, orderedAgents);

  orderedLines.forEach((line, index) => {
    const next = orderedLines[index + 1];
    // A `<p end>` is authoritative when present; a line without one runs until
    // the next line starts, and a final line with no end stays at its start.
    const end = line.endMs > line.startMs ? line.endMs : (next?.startMs ?? line.startMs);
    line.endMs = Math.max(line.startMs, end);
    if (line.words.length) fillWordDurations(line.words, line.endMs);
    if (line.background.length) fillWordDurations(line.background, line.endMs);
  });

  return {
    lines: orderedLines,
    translations,
    ...(translationLanguage ? { translationLanguage } : {}),
  };
}
