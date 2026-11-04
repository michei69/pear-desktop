import type { LyricWord } from '../types';

const TTM_NS = 'http://www.w3.org/ns/ttml#metadata';
const LRC_NS = 'http://lrc.red/lyric-ttml-internal';
const ITUNES_NS = 'http://music.apple.com/lyrics';

/** `<p>` line with word/syllable timings resolved from its `<span>`s. */
export type TTMLParsedLine = {
  timeInMs: number;
  duration: number;
  text: string;
  words: LyricWord[];
  /** Background vocals sung over this line, when the provider has them. */
  background: LyricWord[];
  alignment?: 'start' | 'end';
  rtl?: boolean;
  /** `<p lrc:key>`/`itunes:key`, used to attach TTML translations. */
  key?: string;
};

export type TTMLParseResult = {
  lines: TTMLParsedLine[];
  /** `<ttm:translation>` entries by line key. */
  translations: Record<string, string>;
  translationLanguage?: string;
};

const RTL_LANGUAGES = new Set(['ar', 'dv', 'fa', 'he', 'ku', 'ps', 'ur', 'yi']);

const localName = (element: Element) =>
  (element.localName ?? element.nodeName).toLowerCase();

const elementsWithName = (root: Element | Document, name: string) =>
  Array.from(root.getElementsByTagName('*')).filter(
    (element) => localName(element) === name,
  );

/** Namespaced attribute lookup that also works in DOMs without NS support. */
const attr = (
  element: Element,
  name: string,
  namespace: string,
  prefix: string,
): string | null =>
  element.getAttributeNS(namespace, name) ??
  element.getAttribute(`${prefix}:${name}`) ??
  element.getAttribute(name);

const roleOf = (element: Element) => attr(element, 'role', TTM_NS, 'ttm');

const isBackground = (element: Element) => roleOf(element) === 'x-bg';

/**
 * TTML times: `hh:mm:ss.mmm`, `mm:ss.mmm`, bare seconds and the unit-suffixed
 * `500ms`/`1.5s`/`2m`/`1h` forms.
 */
export const parseTTMLTime = (value: string | null, fallback = 0): number => {
  if (!value) return fallback;

  const normalized = value.trim().toLowerCase();
  const unitMatch = normalized.match(/^(-?\d+(?:\.\d+)?)(ms|h|m|s)$/);
  if (unitMatch) {
    const multipliers: Record<string, number> = {
      ms: 1,
      s: 1000,
      m: 60_000,
      h: 3_600_000,
    };
    return Math.max(
      0,
      Math.round(Number(unitMatch[1]) * multipliers[unitMatch[2]]),
    );
  }

  const parts = normalized.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return fallback;

  const seconds =
    parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts.length === 2
        ? parts[0] * 60 + parts[1]
        : parts.length === 1
          ? parts[0]
          : Number.NaN;

  return Number.isFinite(seconds)
    ? Math.max(0, Math.round(seconds * 1000))
    : fallback;
};

/**
 * The text of one timed span plus the whitespace that follows it. TTML keeps
 * the spaces between spans in text nodes, so they have to be re-attached or the
 * words render run together.
 */
const spanText = (span: Element): string => {
  let text = span.textContent ?? '';
  const next = span.nextSibling;
  if (
    next?.nodeType === 3 &&
    /^\s/.test(next.textContent ?? '') &&
    !/\s$/.test(text)
  ) {
    text += ' ';
  }
  return text;
};

/** True when a timed span wraps more finely timed spans (keep the leaves). */
const hasTimedSpanDescendant = (span: Element): boolean =>
  elementsWithName(span, 'span').some((child) => child.hasAttribute('begin'));

const isInsideBackground = (span: Element, root: Element): boolean => {
  let parent = span.parentElement;
  while (parent && parent !== root) {
    if (isBackground(parent)) return true;
    parent = parent.parentElement;
  }
  return false;
};

/** Timed leaf spans of a `<p>`, split into main and background vocals. */
const collectWords = (
  p: Element,
): { words: LyricWord[]; background: LyricWord[] } => {
  const words: LyricWord[] = [];
  const background: LyricWord[] = [];

  for (const span of elementsWithName(p, 'span')) {
    if (!span.hasAttribute('begin') || hasTimedSpanDescendant(span)) continue;

    const timeInMs = parseTTMLTime(span.getAttribute('begin'));
    const endtime = parseTTMLTime(span.getAttribute('end'), timeInMs);
    const text = spanText(span);
    if (!text.trim()) continue;

    (isInsideBackground(span, p) ? background : words).push({
      text,
      timeInMs,
      duration: Math.max(0, endtime - timeInMs),
    });
  }

  return { words, background };
};

/** `<p>` text with the background-vocal spans removed. */
const lineText = (p: Element): string =>
  Array.from(p.childNodes)
    .filter((node) => !(node.nodeType === 1 && isBackground(node as Element)))
    .map((node) => node.textContent ?? '')
    .join('');

const lineEnd = (p: Element, begin: number): number =>
  parseTTMLTime(p.getAttribute('end'), begin);

const languageOf = (element: Element | null): string | undefined => {
  if (!element) return undefined;
  return (
    element.getAttribute('xml:lang') ??
    element.getAttribute('lang') ??
    undefined
  );
};

/**
 * Duet alignment: with more than one person agent, singers alternate which
 * side of the screen their lines are shown on. Groups stay on the left.
 */
const assignAlignments = (
  lines: TTMLParsedLine[],
  agentTypes: Map<string, string>,
  lineAgents: (string | undefined)[],
) => {
  const personAgents = [
    ...new Set(
      lineAgents.filter(
        (agent): agent is string =>
          Boolean(agent) && agentTypes.get(agent!) !== 'group',
      ),
    ),
  ];
  if (personAgents.length < 2) return;

  const sides = new Map<string, 'start' | 'end'>();
  let nextSide: 'start' | 'end' = 'start';
  for (const agent of personAgents) {
    sides.set(agent, nextSide);
    nextSide = nextSide === 'start' ? 'end' : 'start';
  }

  lines.forEach((line, index) => {
    const agent = lineAgents[index];
    const side = agent ? sides.get(agent) : undefined;
    if (side) line.alignment = side;
  });
};

/**
 * A word is sung until the earlier of its own `<span end>` and the next word:
 * the span end keeps the karaoke fill from bleeding into a gap after the word.
 */
const fillWordDurations = (words: LyricWord[], lineEnd: number) => {
  words.forEach((word, index) => {
    const next = words[index + 1];
    const explicitEnd =
      word.duration > 0 ? word.timeInMs + word.duration : Infinity;
    const availableEnd = next ? next.timeInMs : lineEnd;

    word.duration = Math.max(
      0,
      Math.min(availableEnd, explicitEnd) - word.timeInMs,
    );
  });
};

/**
 * Parses Apple-format TTML (what lrc.red serves): `ttm:agent` singers,
 * word/syllable `<span begin end>` timings, `ttm:role="x-bg"` background
 * vocals and `ttm:translation` lines. Returns null when the payload is not
 * usable TTML.
 */
export const parseTTML = (
  ttml: string,
  DomParser: typeof DOMParser = DOMParser,
): TTMLParseResult | null => {
  if (!ttml.trim()) return null;

  let doc: Document;
  try {
    doc = new DomParser().parseFromString(ttml, 'text/xml');
  } catch {
    return null;
  }

  const root = doc.documentElement;
  if (!root || localName(root) === 'parsererror') return null;

  const language = languageOf(root);
  const primaryLanguage = language?.toLowerCase().split(/[-_]/)[0];

  const agentTypes = new Map<string, string>();
  for (const agent of elementsWithName(doc, 'agent')) {
    const id = agent.getAttribute('xml:id') ?? agent.getAttribute('id');
    const type = agent.getAttribute('type');
    if (id && type) agentTypes.set(id, type);
  }

  const translations: Record<string, string> = {};
  let translationLanguage: string | undefined;
  for (const translation of elementsWithName(doc, 'translation')) {
    const translationLang = languageOf(translation);
    const isSameLanguage =
      translationLang &&
      primaryLanguage &&
      translationLang.toLowerCase().split(/[-_]/)[0] === primaryLanguage;
    // Prefer a translation in another language; same-language ones are usually
    // a romanization and read better in the translation slot only as fallback.
    if (isSameLanguage) continue;

    for (const text of elementsWithName(translation, 'text')) {
      const key = text.getAttribute('for');
      const value = text.textContent?.trim();
      if (!key || !value) continue;
      translations[key] = value;
      translationLanguage ??= translationLang;
    }
  }

  const lines: TTMLParsedLine[] = [];
  const lineAgents: (string | undefined)[] = [];

  for (const p of elementsWithName(doc, 'p')) {
    const begin = parseTTMLTime(p.getAttribute('begin'));
    const end = lineEnd(p, begin);
    const { words, background } = collectWords(p);
    const key =
      attr(p, 'key', LRC_NS, 'lrc') ??
      attr(p, 'key', ITUNES_NS, 'itunes') ??
      undefined;
    const agent = attr(p, 'agent', TTM_NS, 'ttm') ?? undefined;
    const pLanguage = languageOf(p) ?? language;

    const content = lineText(p).trim();
    const text = words.length
      ? words
          .map((word) => word.text)
          .join('')
          .trim()
      : content;

    lines.push({
      timeInMs: begin,
      duration: Math.max(0, end - begin),
      text,
      words,
      background,
      key,
      rtl:
        p.getAttribute('dir') === 'rtl' ||
        Boolean(
          pLanguage &&
          RTL_LANGUAGES.has(pLanguage.toLowerCase().split(/[-_]/)[0]),
        )
          ? true
          : undefined,
    });
    lineAgents.push(agent);
  }

  if (!lines.length) return null;

  const sorted = lines
    .map((line, index) => ({ line, agent: lineAgents[index] }))
    .sort((a, b) => a.line.timeInMs - b.line.timeInMs);

  const orderedLines = sorted.map((entry) => entry.line);
  const orderedAgents = sorted.map((entry) => entry.agent);

  assignAlignments(orderedLines, agentTypes, orderedAgents);

  orderedLines.forEach((line, index) => {
    const next = orderedLines[index + 1];
    const declaredEnd = line.timeInMs + line.duration;
    // A `<p end>` is authoritative when present; a line without one runs until
    // the next line starts.
    const end =
      declaredEnd > line.timeInMs
        ? declaredEnd
        : next
          ? next.timeInMs
          : Infinity;
    line.duration = Math.max(0, end - line.timeInMs);
    if (line.words.length) fillWordDurations(line.words, end);
    if (line.background.length) fillWordDurations(line.background, end);
  });

  return {
    lines: orderedLines,
    translations,
    translationLanguage,
  };
};
