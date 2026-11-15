import { buildSystemPrompt, buildUserPrompt, parseLinesFromJson } from "../prompt.ts";
import type { ProviderEnv, TranslationProvider, TranslationProviderSettings } from "../types.ts";

const REQUEST_TIMEOUT_MS = 90_000;

export const geminiProvider: TranslationProvider = {
  name: "gemini",
  async translate(req, settings, env: ProviderEnv) {
    const { apiKey, model } = settings as TranslationProviderSettings["gemini"];
    if (!apiKey) throw new Error("Gemini: apiKey is empty");
    if (!model?.trim()) throw new Error("Gemini: model is empty");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model.trim(),
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await env.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { role: "system", parts: [{ text: buildSystemPrompt(req) }] },
        contents: [{ role: "user", parts: [{ text: buildUserPrompt(req) }] }],
        generationConfig: { temperature: 0.3, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Gemini API ${response.status}: ${body.slice(0, 300)}`);
    }

    const json = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = (json.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("");
    const parsed = parseLinesFromJson(text);
    if (!parsed) throw new Error("Could not parse JSON from the Gemini response");
    return parsed;
  },
};
