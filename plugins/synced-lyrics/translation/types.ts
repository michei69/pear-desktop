// Translation settings and the shape providers work with. Host side only.

import type { Fetch } from "../providers/http.ts";
import type { LocalCliProviderEngine, OpenAICompatibleApiMode, TranslationProviderName, TranslationTargetLanguage } from "../types.ts";

export interface TranslationProviderSettings {
  "openai-compatible": {
    baseUrl: string;
    apiKey: string;
    model: string;
    apiMode?: OpenAICompatibleApiMode;
  };
  anthropic: { apiKey: string; model: string };
  gemini: { apiKey: string; model: string };
  "local-cli": {
    engine: LocalCliProviderEngine;
    command?: string;
    model?: string;
    timeoutSeconds: number;
  };
  "google-translate": {
    host: string;
  };
}

/** The translation part of the plugin's flat config, as providers see it. */
export interface TranslationConfig {
  enabled: boolean;
  provider: TranslationProviderName;
  targetLanguage: TranslationTargetLanguage;
  providers: TranslationProviderSettings;
}

export interface TranslationRequest {
  title: string;
  artists: string[];
  targetLanguage: string;
  resolvedTargetLanguage: string;
  lines: string[];
}

export interface ProviderEnv {
  fetch: Fetch;
  /** Working directory for local CLIs and where they may write. */
  userData: string;
}

export interface TranslationProvider {
  name: TranslationProviderName;
  translate(req: TranslationRequest, settings: TranslationProviderSettings[TranslationProviderName], env: ProviderEnv): Promise<string[]>;
}

export interface CacheEntry {
  key: string;
  strategyVersion: string;
  title: string;
  artists: string[];
  targetLanguage: string;
  provider: string;
  model: string;
  sourceHash: string;
  sourceLines: string[];
  createdAt: number;
  lines: string[];
}

/** Why a translation produced no lines; the API turns these into statuses. */
export type TranslationFailureReason = "disabled" | "no-lyrics" | "provider-error";

export interface TranslationResult {
  provider: TranslationProviderName | null;
  language: string;
  lines: string[];
  fromCache?: boolean;
  /** The lyrics were already in the requested language; `lines` are the originals. */
  sameLanguage?: boolean;
  error?: string;
  /** Present exactly when `lines` is empty. */
  reason?: TranslationFailureReason;
}
