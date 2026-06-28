import { translationProviders } from './providers';

import type {
  TranslationProviderName,
  TranslationProviderSettings,
} from '../types';
import type { TranslationProvider, TranslationRequest } from './types';

const callOnce = async (
  provider: TranslationProvider,
  req: TranslationRequest,
  settings: TranslationProviderSettings[TranslationProviderName],
): Promise<string[]> => provider.translate(req, settings);

const shouldFallbackPerLine = (err: unknown, lineCount: number): boolean => {
  if (lineCount > 8) return false;

  const message = err instanceof Error ? err.message : String(err);
  return /parse|json|line|length|number of lines/i.test(message);
};

/**
 * Translates the full set of lyrics with one whole-song call (preserving
 * context). Falls back to a per-line call only if the whole-song path fails
 * to produce the right number of lines after one retry.
 */
export const runTranslation = async (
  providerName: TranslationProviderName,
  settings: TranslationProviderSettings[TranslationProviderName],
  req: TranslationRequest,
): Promise<string[]> => {
  const provider = translationProviders[providerName];
  if (!provider) throw new Error(`Unknown provider: ${providerName}`);

  if (req.lines.length === 0) return [];

  let translated: string[];
  try {
    translated = await callOnce(provider, req, settings);
    if (translated.length !== req.lines.length) {
      // Length mismatch — retry once.
      translated = await callOnce(provider, req, settings);
    }
    if (translated.length !== req.lines.length) {
      throw new Error(
        `Translation returned ${translated.length} lines; expected ${req.lines.length}`,
      );
    }
  } catch (firstErr) {
    if (!shouldFallbackPerLine(firstErr, req.lines.length)) {
      throw firstErr;
    }

    // Last-ditch: per-line fallback (loses cross-line context but is safer).
    try {
      translated = await Promise.all(
        req.lines.map((line) =>
          callOnce(provider, { ...req, lines: [line] }, settings).then(
            (out) => out[0] ?? '',
          ),
        ),
      );
    } catch {
      throw firstErr;
    }
  }

  return translated;
};
