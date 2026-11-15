import { normalizeGoogleTranslateHost } from "./google-translate-host.ts";
import { isSkippableLine } from "../prompt.ts";
import type { ProviderEnv, TranslationProvider, TranslationProviderSettings } from "../types.ts";

type IndexedLine = { index: number; text: string };

const MAX_CHUNK_LINES = 40;
const MAX_CHUNK_CHARS = 4500;
const REQUEST_TIMEOUT_MS = 20_000;

const translatableLines = (lines: readonly string[]): IndexedLine[] =>
  lines.flatMap((text, index) => (text.trim() && !isSkippableLine(text) ? [{ index, text }] : []));

/** Put translated lines back at their source indexes, keeping skipped lines as they were. */
function mergeTranslatedLines(sourceLines: readonly string[], indexed: readonly IndexedLine[], translated: readonly string[]) {
  const output = sourceLines.map((line) => (isSkippableLine(line) ? line : ""));
  indexed.forEach((item, i) => {
    output[item.index] = translated[i] ?? "";
  });
  return output;
}

const googleTargetLanguage = (language: string) => (language.toLowerCase() === "fil" ? "tl" : language);

function splitByMarkers(text: string, expected: number) {
  const pattern = /<{2,}\s*YTMD\s*[_-]\s*LYRICS\s*[_-]\s*LINE\s*[_-]\s*(\d{4})\s*>{2,}/gi;
  const matches = Array.from(text.matchAll(pattern));
  if (matches.length !== expected - 1) return null;

  const output: string[] = [];
  let cursor = 0;
  for (const match of matches) {
    const index = match.index ?? -1;
    if (index < cursor) return null;
    output.push(text.slice(cursor, index).trim());
    cursor = index + match[0].length;
  }
  output.push(text.slice(cursor).trim());
  return output.length === expected ? output : null;
}

function splitByHtmlBreaks(text: string, expected: number) {
  const lines = text
    .replace(/&lt;\s*br\s*\/?\s*&gt;/gi, "<br>")
    .split(/<\s*br\s*\/?\s*>/gi)
    .map((line) => line.trim());
  return lines.length === expected ? lines : null;
}

const markerFor = (index: number) => `<<<YTMD_LYRICS_LINE_${String(index).padStart(4, "0")}>>>`;

async function translateText(fetch: ProviderEnv["fetch"], text: string, target: string, host: string) {
  const url = `https://${host}/translate_a/single?client=at&dt=t&dt=rm&dj=1`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams({ sl: "auto", tl: target, q: text }).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Google Translate request failed (${response.status} ${response.statusText}): ${body.slice(0, 300)}`);
  }
  const raw = JSON.parse(body) as { sentences?: { trans?: string }[] };
  return (raw.sentences ?? []).flatMap((sentence) => (sentence.trans ? [sentence.trans] : [])).join("");
}

function chunkIndexedLines(lines: readonly IndexedLine[]) {
  const chunks: IndexedLine[][] = [];
  let chunk: IndexedLine[] = [];
  let chars = 0;

  for (const line of lines) {
    const markerLength = chunk.length === 0 ? 0 : markerFor(chunk.length).length;
    const nextChars = line.text.length + markerLength + 2;
    if (chunk.length > 0 && (chunk.length >= MAX_CHUNK_LINES || chars + nextChars > MAX_CHUNK_CHARS)) {
      chunks.push(chunk);
      chunk = [];
      chars = 0;
    }
    chunk.push(line);
    chars += nextChars;
  }

  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

async function translateChunk(fetch: ProviderEnv["fetch"], chunk: readonly IndexedLine[], target: string, host: string) {
  if (chunk.length === 1) return [await translateText(fetch, chunk[0]!.text, target, host)];

  // Markers survive translation better than newlines; HTML breaks are the next best.
  const marked = chunk.map((line, index) => (index === 0 ? line.text : `${markerFor(index)}\n${line.text}`)).join("\n");
  const markedText = await translateText(fetch, marked, target, host);
  const markedLines = splitByMarkers(markedText, chunk.length);
  if (markedLines) return markedLines;

  const htmlText = await translateText(fetch, chunk.map((line) => line.text).join("<br>"), target, host);
  const htmlLines = splitByHtmlBreaks(htmlText, chunk.length);
  if (htmlLines) return htmlLines;

  const newlineLines = htmlText.split(/\r?\n/).map((line) => line.trim());
  if (newlineLines.length === chunk.length) return newlineLines;

  throw new Error("Google Translate did not preserve lyric line boundaries");
}

export const googleTranslateProvider: TranslationProvider = {
  name: "google-translate",
  async translate(req, settings, env: ProviderEnv) {
    const { host: rawHost } = settings as TranslationProviderSettings["google-translate"];
    const host = normalizeGoogleTranslateHost(rawHost);
    const target = googleTargetLanguage(req.resolvedTargetLanguage);
    const indexed = translatableLines(req.lines);
    if (indexed.length === 0) return mergeTranslatedLines(req.lines, [], []);

    const chunks = chunkIndexedLines(indexed);
    console.info("[pear:synced-lyrics] Google Translate request", {
      host,
      target,
      chunks: chunks.length,
      lines: indexed.length,
    });

    const translated: string[] = [];
    for (const chunk of chunks) {
      try {
        translated.push(...(await translateChunk(env.fetch, chunk, target, host)));
      } catch (error) {
        // One chunk's boundaries failed: fall back to a request per line, so a
        // partial answer still shows instead of losing the whole song.
        console.warn("[pear:synced-lyrics] Google Translate chunk failed; retrying per line", error);
        for (const line of chunk) translated.push(await translateText(env.fetch, line.text, target, host));
      }
    }

    return mergeTranslatedLines(req.lines, indexed, translated);
  },
};
