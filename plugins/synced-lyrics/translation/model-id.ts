import { normalizeGoogleTranslateHost } from "./providers/google-translate-host.ts";
import type { TranslationProviderName } from "../types.ts";
import type { TranslationProviderSettings } from "./types.ts";

/** The model (or engine/host) part of the cache key. */
export function getTranslationModelId(provider: TranslationProviderName, settings: TranslationProviderSettings[TranslationProviderName]) {
  if (provider === "local-cli") {
    const local = settings as TranslationProviderSettings["local-cli"];
    return `${local.engine}:auto`;
  }
  if (provider === "google-translate") {
    const google = settings as TranslationProviderSettings["google-translate"];
    return `google-translate:${normalizeGoogleTranslateHost(google.host)}`;
  }
  const model = "model" in settings ? settings.model : undefined;
  return typeof model === "string" ? model : "";
}
