import type { TranslationRequest } from "./types.ts";

const skipPattern = /^[\s♪•·.…\-—_~()【】[\]{}「」『』<>/\\|"'`*+=#@$%^&!?，。！？、；：…—]+$/;

/** Punctuation, symbols and musical marks: copied through instead of translated. */
export const isSkippableLine = (line: string) => !line || skipPattern.test(line.trim());

export function buildSystemPrompt(req: TranslationRequest) {
  const lang = req.resolvedTargetLanguage;
  return [
    `You are a careful song-lyrics translator. Translate the complete song into ${lang}.`,
    "Read the title, artists, and the full lyrics as one complete lyric/poem before choosing any wording.",
    "Rules:",
    '- Output ONLY a JSON object: {"lines": ["...", "..."]}.',
    `- The "lines" array MUST have exactly ${req.lines.length} entries, in the same order as the input.`,
    "- The array is only for display alignment: each entry corresponds to the same-numbered original line after full-song translation.",
    "- Do not translate lines as isolated fragments. Use the full song context, speaker/listener relationship, repeated motifs, and neighboring lines.",
    "- Use natural, emotionally coherent wording. It is okay for a translated line to be slightly longer when needed to preserve meaning.",
    "- Keep repeated refrains and recurring images consistent unless the original clearly shifts them.",
    "- For Japanese lyrics, resolve omitted subjects, particles, ruby text, and line-break enjambment from context.",
    "- When translating into Chinese, avoid stiff word-for-word Japanese syntax; preserve ambiguity and imagery while making the line read like natural Chinese lyrics.",
    "- Keep proper nouns, brand names, and untranslatable interjections as-is when natural.",
    "- For lines that contain only punctuation, symbols, or musical marks (e.g. ♪), copy them unchanged.",
    "- Do NOT include any explanation, notes, or the [N] index prefix in the output.",
  ].join("\n");
}

export function buildUserPrompt(req: TranslationRequest) {
  const header = [
    `Song title: ${req.title || "(unknown)"}`,
    `Artist(s): ${req.artists.length ? req.artists.join(", ") : "(unknown)"}`,
    `Target language: ${req.resolvedTargetLanguage}`,
    `Display alignment line count: ${req.lines.length}`,
    "Translate the entire song below as one coherent lyric. The numbers exist only so your JSON array can stay aligned with the original lines.",
    'Return valid json only: {"lines":["..."]}.',
    "",
    "Full lyrics:",
  ].join("\n");
  const body = req.lines.map((line, i) => `${i + 1}. ${line}`).join("\n");
  return `${header}\n${body}`;
}

/** The `lines` array of a model answer, tolerating fences and stray prose. */
export function parseLinesFromJson(raw: string): string[] | null {
  const text = raw.trim();

  const tryParse = (input: string): string[] | null => {
    try {
      const value = JSON.parse(input) as unknown;
      if (Array.isArray(value)) {
        const lines = value.filter((item): item is string => typeof item === "string");
        return lines.length ? lines : null;
      }
      if (value && typeof value === "object" && "lines" in value && Array.isArray(value.lines)) {
        const lines = value.lines.filter((item): item is string => typeof item === "string");
        return lines.length ? lines : null;
      }
    } catch {
      // fall through
    }
    return null;
  };

  let parsed = tryParse(text);
  if (parsed) return parsed;

  const fenced = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  parsed = tryParse(fenced);
  if (parsed) return parsed;

  // Last-ditch: the first {...} or [...] substring.
  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    parsed = tryParse(text.slice(objectStart, objectEnd + 1));
    if (parsed) return parsed;
  }
  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    parsed = tryParse(text.slice(arrayStart, arrayEnd + 1));
    if (parsed) return parsed;
  }
  return null;
}
