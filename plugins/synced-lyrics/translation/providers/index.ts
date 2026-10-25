import { anthropicProvider } from "./anthropic.ts";
import { geminiProvider } from "./gemini.ts";
import { googleTranslateProvider } from "./google-translate.ts";
import { localCliProvider } from "./local-cli.ts";
import { openAICompatibleProvider } from "./openai-compatible.ts";
import type { TranslationProviderName } from "../../types.ts";
import type { TranslationProvider } from "../types.ts";

export const translationProviders: Record<TranslationProviderName, TranslationProvider> = {
  "openai-compatible": openAICompatibleProvider,
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  "local-cli": localCliProvider,
  "google-translate": googleTranslateProvider,
};
