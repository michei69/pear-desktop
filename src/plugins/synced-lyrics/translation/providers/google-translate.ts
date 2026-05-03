import { net } from 'electron';

import { normalizeGoogleTranslateHost } from './google-translate-host';

import { isSkippableLine } from '../prompt';

import type { TranslationProvider } from '../types';

type IndexedLine = { index: number; text: string };
type GoogleTranslateRaw = {
  sentences?: Array<{
    trans?: string;
  }>;
};

const MAX_CHUNK_LINES = 40;
const MAX_CHUNK_CHARS = 4500;
const REQUEST_TIMEOUT_MS = 20000;

const translatableLines = (lines: string[]): IndexedLine[] =>
  lines
    .map((text, index) => ({ index, text }))
    .filter(({ text }) => text.trim() && !isSkippableLine(text));

const mergeTranslatedLines = (
  sourceLines: string[],
  indexed: IndexedLine[],
  translated: string[],
): string[] => {
  const output = sourceLines.map((line) => (isSkippableLine(line) ? line : ''));
  for (const [idx, item] of indexed.entries()) {
    output[item.index] = translated[idx] ?? '';
  }
  return output;
};

const googleTargetLanguage = (language: string): string => {
  if (language.toLowerCase() === 'fil') return 'tl';
  return language;
};

const splitTranslatedText = (text: string, expectedLength: number) => {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  return lines.length === expectedLength ? lines : null;
};

const markerFor = (index: number) =>
  `<<<YTMD_LYRICS_LINE_${String(index).padStart(4, '0')}>>>`;

const splitByMarkers = (text: string, expectedLength: number) => {
  const pattern =
    /<{2,}\s*YTMD\s*[_-]\s*LYRICS\s*[_-]\s*LINE\s*[_-]\s*(\d{4})\s*>{2,}/gi;
  const matches = Array.from(text.matchAll(pattern));
  if (matches.length !== expectedLength - 1) return null;

  const output: string[] = [];
  let cursor = 0;
  for (const match of matches) {
    const index = match.index ?? -1;
    if (index < cursor) return null;
    output.push(text.slice(cursor, index).trim());
    cursor = index + match[0].length;
  }
  output.push(text.slice(cursor).trim());

  return output.length === expectedLength ? output : null;
};

const splitByHtmlBreaks = (text: string, expectedLength: number) => {
  const lines = text
    .replace(/&lt;\s*br\s*\/?\s*&gt;/gi, '<br>')
    .split(/<\s*br\s*\/?\s*>/gi)
    .map((line) => line.trim());
  return lines.length === expectedLength ? lines : null;
};

const buildTranslatedText = (raw: GoogleTranslateRaw): string =>
  (raw.sentences ?? [])
    .map((sentence) => sentence.trans ?? '')
    .filter(Boolean)
    .join('');

const translateText = async (
  text: string,
  target: string,
  host: string,
): Promise<string> => {
  const url = `https://${host}/translate_a/single?client=at&dt=t&dt=rm&dj=1`;
  const body = new URLSearchParams({
    sl: 'auto',
    tl: target,
    q: text,
  }).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const res = await net
    .fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body,
      signal: controller.signal,
    })
    .finally(() => clearTimeout(timeout));
  const responseText = await res.text();
  if (!res.ok) {
    throw new Error(
      `Google Translate request failed (${res.status} ${res.statusText}): ${responseText.slice(0, 300)}`,
    );
  }

  const raw = JSON.parse(responseText) as GoogleTranslateRaw;
  return buildTranslatedText(raw);
};

const chunkIndexedLines = (lines: IndexedLine[]): IndexedLine[][] => {
  const chunks: IndexedLine[][] = [];
  let chunk: IndexedLine[] = [];
  let chars = 0;

  for (const line of lines) {
    const markerLength =
      chunk.length === 0 ? 0 : markerFor(chunk.length).length;
    const nextChars = line.text.length + markerLength + 2;
    if (
      chunk.length > 0 &&
      (chunk.length >= MAX_CHUNK_LINES || chars + nextChars > MAX_CHUNK_CHARS)
    ) {
      chunks.push(chunk);
      chunk = [];
      chars = 0;
    }

    chunk.push(line);
    chars += nextChars;
  }

  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
};

const translateChunk = async (
  chunk: IndexedLine[],
  target: string,
  host: string,
): Promise<string[]> => {
  if (chunk.length === 1) {
    return [await translateText(chunk[0].text, target, host)];
  }

  const marked = chunk
    .map((line, index) =>
      index === 0 ? line.text : `${markerFor(index)}\n${line.text}`,
    )
    .join('\n');
  const markedText = await translateText(marked, target, host);
  const markedLines = splitByMarkers(markedText, chunk.length);
  if (markedLines) return markedLines;

  const htmlText = await translateText(
    chunk.map((line) => line.text).join('<br>'),
    target,
    host,
  );
  const htmlLines = splitByHtmlBreaks(htmlText, chunk.length);
  if (htmlLines) return htmlLines;

  const newlineLines = splitTranslatedText(htmlText, chunk.length);
  if (newlineLines) return newlineLines;

  throw new Error('Google Translate did not preserve lyric line boundaries');
};

export const googleTranslateProvider: TranslationProvider = {
  name: 'google-translate',
  async translate(req, settings) {
    const { host: rawHost = 'translate.google.com' } = settings as {
      host?: string;
    };
    const host = normalizeGoogleTranslateHost(rawHost);
    const target = googleTargetLanguage(req.resolvedTargetLanguage);
    const indexed = translatableLines(req.lines);
    if (indexed.length === 0) return mergeTranslatedLines(req.lines, [], []);

    const chunks = chunkIndexedLines(indexed);
    console.info('[synced-lyrics] Google Translate request', {
      host,
      target,
      chunks: chunks.length,
      lines: indexed.length,
    });

    const translated: string[] = [];
    for (const chunk of chunks) {
      translated.push(...(await translateChunk(chunk, target, host)));
    }

    return mergeTranslatedLines(req.lines, indexed, translated);
  },
};
