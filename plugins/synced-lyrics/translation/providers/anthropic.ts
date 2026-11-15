import { buildSystemPrompt, buildUserPrompt, parseLinesFromJson } from "../prompt.ts";
import type { ProviderEnv, TranslationProvider, TranslationProviderSettings } from "../types.ts";

const REQUEST_TIMEOUT_MS = 90_000;

export const anthropicProvider: TranslationProvider = {
  name: "anthropic",
  async translate(req, settings, env: ProviderEnv) {
    const { apiKey, model } = settings as TranslationProviderSettings["anthropic"];
    if (!apiKey) throw new Error("Anthropic: apiKey is empty");
    if (!model?.trim()) throw new Error("Anthropic: model is empty");

    const response = await env.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model.trim(),
        max_tokens: 4096,
        system: buildSystemPrompt(req),
        messages: [
          { role: "user", content: buildUserPrompt(req) },
          // Prefill the assistant turn so the model continues from the JSON object.
          { role: "assistant", content: "{" },
        ],
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Anthropic API ${response.status}: ${body.slice(0, 300)}`);
    }

    const json = (await response.json()) as { content?: { type?: string; text?: string }[] };
    const text = (json.content ?? [])
      .flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
      .join("");
    const parsed = parseLinesFromJson(`{${text}`);
    if (!parsed) throw new Error("Could not parse JSON from the Anthropic response");
    return parsed;
  },
};
