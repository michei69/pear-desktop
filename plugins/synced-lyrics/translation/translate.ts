import { translationProviders } from "./providers/index.ts";
import { isSkippableLine } from "./prompt.ts";
import type { ProviderEnv, TranslationProvider, TranslationRequest, TranslationProviderSettings } from "./types.ts";
import type { TranslationProviderName } from "../types.ts";

/** Above this a whole-song prompt is likely to be truncated; translate in sections. */
const MAX_SECTION_LINES = 120;
const MAX_SECTION_CHARS = 16_000;
const SECTION_LINES = 60;
const SECTION_CHARS = 8_000;
/** Per-line fallback requests in flight at once. */
const PER_LINE_CONCURRENCY = 4;

function sectionsOf(lines: readonly string[]) {
  const sections: string[][] = [];
  let section: string[] = [];
  let chars = 0;
  for (const line of lines) {
    if (section.length > 0 && (section.length >= SECTION_LINES || chars + line.length > SECTION_CHARS)) {
      sections.push(section);
      section = [];
      chars = 0;
    }
    section.push(line);
    chars += line.length + 1;
  }
  if (section.length > 0) sections.push(section);
  return sections;
}

type AnySettings = TranslationProviderSettings[TranslationProviderName];

function callProvider(provider: TranslationProvider, req: TranslationRequest, settings: AnySettings, env: ProviderEnv) {
  return provider.translate(req, settings, env);
}

/** A translation per line, keeping punctuation lines as they are; failures leave an empty line. */
async function translatePerLine(
  provider: TranslationProvider,
  req: TranslationRequest,
  settings: AnySettings,
  env: ProviderEnv,
  originalError: unknown,
) {
  const output = req.lines.slice();
  const indexes = req.lines.flatMap((line, index) => (isSkippableLine(line) ? [] : [index]));
  let succeeded = 0;

  for (let start = 0; start < indexes.length; start += PER_LINE_CONCURRENCY) {
    const batch = indexes.slice(start, start + PER_LINE_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (index) => {
        try {
          const translated = await callProvider(provider, { ...req, lines: [req.lines[index]!] }, settings, env);
          return translated[0] ?? "";
        } catch {
          return "";
        }
      }),
    );
    results.forEach((text, i) => {
      if (!text) return;
      output[batch[i]!] = text;
      succeeded += 1;
    });
  }

  if (succeeded === 0) throw originalError;
  return output;
}

async function translateSection(provider: TranslationProvider, req: TranslationRequest, settings: AnySettings, env: ProviderEnv) {
  if (req.lines.every((line) => isSkippableLine(line))) return req.lines.slice();

  const mismatch = () => new Error(`Translation returned the wrong number of lines; expected ${req.lines.length}`);
  try {
    let translated = await callProvider(provider, req, settings, env);
    if (translated.length !== req.lines.length) translated = await callProvider(provider, req, settings, env);
    if (translated.length === req.lines.length) return translated;
    return await translatePerLine(provider, req, settings, env, mismatch());
  } catch (error) {
    return translatePerLine(provider, req, settings, env, error);
  }
}

/**
 * Translates the whole song in one call so the model keeps the song's context.
 * Long songs are split into sections (Google Translate additionally chunks
 * inside each one). When a call fails or returns the wrong line count, the
 * section is retried line by line, so one bad answer never loses the view.
 */
export async function runTranslation(
  providerName: TranslationProviderName,
  settings: TranslationProviderSettings[TranslationProviderName],
  req: TranslationRequest,
  env: ProviderEnv,
) {
  const provider = translationProviders[providerName];
  if (!provider) throw new Error(`Unknown translation provider: ${providerName}`);
  if (req.lines.length === 0) return [];

  const chars = req.lines.reduce((total, line) => total + line.length + 1, 0);
  if (req.lines.length <= MAX_SECTION_LINES && chars <= MAX_SECTION_CHARS) {
    return translateSection(provider, req, settings, env);
  }

  const output: string[] = [];
  for (const lines of sectionsOf(req.lines)) {
    output.push(...(await translateSection(provider, { ...req, lines }, settings, env)));
  }
  return output;
}
