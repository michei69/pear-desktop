import type { TranslationRequest } from './types';

const skipPattern =
  /^[\s♪•·.…\-—_~()【】[\]{}「」『』<>/\\|"'`*+=#@$%^&!?，。！？、；：…—]+$/;

export const isSkippableLine = (line: string): boolean => {
  if (!line) return true;
  return skipPattern.test(line.trim());
};

export const buildSystemPrompt = (req: TranslationRequest): string => {
  const lang = req.resolvedTargetLanguage;
  return [
    `You are a careful song-lyrics translator. Translate the complete song into ${lang}.`,
    'Read the title, artists, and the full lyrics as one complete lyric/poem before choosing any wording.',
    'Rules:',
    '- Output ONLY a JSON object: {"lines": ["...", "..."]}.',
    `- The "lines" array MUST have exactly ${req.lines.length} entries, in the same order as the input.`,
    '- The array is only for display alignment: each entry corresponds to the same-numbered original line after full-song translation.',
    '- Do not translate lines as isolated fragments. Use the full song context, speaker/listener relationship, repeated motifs, and neighboring lines.',
    '- Use natural, emotionally coherent wording. It is okay for a translated line to be slightly longer when needed to preserve meaning.',
    '- Keep repeated refrains and recurring images consistent unless the original clearly shifts them.',
    '- For Japanese lyrics, resolve omitted subjects, particles, ruby text, and line-break enjambment from context.',
    '- When translating into Chinese, avoid stiff word-for-word Japanese syntax; preserve ambiguity and imagery while making the line read like natural Chinese lyrics.',
    '- Keep proper nouns, brand names, and untranslatable interjections as-is when natural.',
    '- For lines that contain only punctuation, symbols, or musical marks (e.g. ♪), copy them unchanged.',
    '- Do NOT include any explanation, notes, or the [N] index prefix in the output.',
  ].join('\n');
};

export const buildUserPrompt = (req: TranslationRequest): string => {
  const header = [
    `Song title: ${req.title || '(unknown)'}`,
    `Artist(s): ${req.artists.length ? req.artists.join(', ') : '(unknown)'}`,
    `Target language: ${req.resolvedTargetLanguage}`,
    `Display alignment line count: ${req.lines.length}`,
    'Translate the entire song below as one coherent lyric. The numbers exist only so your JSON array can stay aligned with the original lines.',
    'Return valid json only: {"lines":["..."]}.',
    '',
    'Full lyrics:',
  ].join('\n');
  const body = req.lines.map((line, i) => `${i + 1}. ${line}`).join('\n');
  return `${header}\n${body}`;
};

export const parseLinesFromJson = (
  raw: string,
  expected: number,
): string[] | null => {
  const text = raw.trim();
  // Try direct JSON object {"lines":[...]}
  const tryParse = (input: string): string[] | null => {
    try {
      const obj = JSON.parse(input);
      if (Array.isArray(obj)) {
        const arr = obj.filter((x): x is string => typeof x === 'string');
        return arr.length === expected ? arr : arr;
      }
      if (
        obj &&
        typeof obj === 'object' &&
        Array.isArray((obj as { lines?: unknown }).lines)
      ) {
        const arr = (obj as { lines: unknown[] }).lines.filter(
          (x): x is string => typeof x === 'string',
        );
        return arr;
      }
    } catch {
      // fall through
    }
    return null;
  };

  let parsed = tryParse(text);
  if (parsed) return parsed;

  // Strip ``` fences and retry
  const fenced = text
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  parsed = tryParse(fenced);
  if (parsed) return parsed;

  // Last-ditch: extract first {...} or [...] substring
  const objStart = text.indexOf('{');
  const objEnd = text.lastIndexOf('}');
  if (objStart !== -1 && objEnd > objStart) {
    parsed = tryParse(text.slice(objStart, objEnd + 1));
    if (parsed) return parsed;
  }
  const arrStart = text.indexOf('[');
  const arrEnd = text.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd > arrStart) {
    parsed = tryParse(text.slice(arrStart, arrEnd + 1));
    if (parsed) return parsed;
  }
  return null;
};
