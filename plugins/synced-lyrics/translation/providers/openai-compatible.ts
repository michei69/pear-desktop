import { buildSystemPrompt, buildUserPrompt, parseLinesFromJson } from "../prompt.ts";
import type { ProviderEnv, TranslationProvider, TranslationProviderSettings } from "../types.ts";

const REQUEST_TIMEOUT_MS = 90_000;

class ProviderHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const trimUrl = (baseUrl: string) => baseUrl.trim().replace(/\/+$/, "");

function chatCompletionsUrl(baseUrl: string) {
  const url = trimUrl(baseUrl);
  return /\/chat\/completions$/i.test(url) ? url : `${url}/chat/completions`;
}

function responsesUrl(baseUrl: string) {
  const url = trimUrl(baseUrl);
  if (/\/responses$/i.test(url)) return url;
  if (/\/chat\/completions$/i.test(url)) return url.replace(/\/chat\/completions$/i, "/responses");
  return `${url}/responses`;
}

const rejectedJsonMode = (error: ProviderHttpError) =>
  error.status === 400 && /response_format|json_object|text\.format|json/i.test(error.body);
const rejectedTemperature = (error: ProviderHttpError) => error.status === 400 && /temperature/i.test(error.body);
const responsesUnavailable = (error: ProviderHttpError) => [404, 405, 501].includes(error.status) || /responses/i.test(error.body);

function extractResponseText(json: unknown) {
  if (json && typeof json === "object" && "output_text" in json && typeof json.output_text === "string") {
    return json.output_text;
  }
  if (!json || typeof json !== "object" || !("output" in json) || !Array.isArray(json.output)) return "";
  return json.output
    .flatMap((item: unknown) => {
      if (!item || typeof item !== "object" || !("content" in item) || !Array.isArray(item.content)) return [];
      return item.content;
    })
    .map((part: unknown) => {
      if (!part || typeof part !== "object") return "";
      if ("text" in part && typeof part.text === "string") return part.text;
      if ("output_text" in part && typeof part.output_text === "string") return part.output_text;
      return "";
    })
    .join("");
}

export const openAICompatibleProvider: TranslationProvider = {
  name: "openai-compatible",
  async translate(req, settings, env: ProviderEnv) {
    const { baseUrl, apiKey, model: rawModel, apiMode = "auto" } = settings as TranslationProviderSettings["openai-compatible"];
    const model = rawModel?.trim();
    if (!baseUrl?.trim()) throw new Error("OpenAI-compatible: baseUrl is empty");
    if (!model) throw new Error("OpenAI-compatible: model is empty");

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const post = async (url: string, body: object) => {
      const response = await env.fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return response;
      const text = await response.text().catch(() => "");
      throw new ProviderHttpError(`OpenAI-compatible API ${response.status}: ${text.slice(0, 300)}`, response.status, text);
    };

    /** One endpoint, retrying without the optional fields a local server rejects. */
    const call = async (url: string, buildBody: (jsonMode: boolean, temperature: boolean) => object) => {
      let jsonMode = true;
      let temperature = true;
      try {
        return await post(url, buildBody(jsonMode, temperature));
      } catch (error) {
        if (!(error instanceof ProviderHttpError)) throw error;
        if (rejectedTemperature(error)) temperature = false;
        else if (rejectedJsonMode(error)) jsonMode = false;
        else throw error;
        return post(url, buildBody(jsonMode, temperature));
      }
    };

    const translateWithResponses = async () => {
      const url = responsesUrl(baseUrl);
      console.info("[pear:synced-lyrics] OpenAI-compatible Responses API request", { url, model, lines: req.lines.length });
      const response = await call(url, (jsonMode, temperature) => ({
        model,
        instructions: buildSystemPrompt(req),
        input: buildUserPrompt(req),
        ...(jsonMode ? { text: { format: { type: "json_object" } } } : {}),
        ...(temperature ? { temperature: 0.3 } : {}),
      }));
      const parsed = parseLinesFromJson(extractResponseText(await response.json()));
      if (!parsed) throw new Error("Could not parse JSON from the Responses API response");
      return parsed;
    };

    const translateWithChatCompletions = async () => {
      const url = chatCompletionsUrl(baseUrl);
      console.info("[pear:synced-lyrics] OpenAI-compatible API request", { url, model, lines: req.lines.length });
      const response = await call(url, (jsonMode, temperature) => ({
        model,
        messages: [
          { role: "system", content: buildSystemPrompt(req) },
          { role: "user", content: buildUserPrompt(req) },
        ],
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        ...(temperature ? { temperature: 0.3 } : {}),
      }));
      const json = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
      const content = json.choices?.[0]?.message?.content;
      const parsed = parseLinesFromJson(typeof content === "string" ? content : "");
      if (!parsed) throw new Error("Could not parse JSON from the OpenAI-compatible response");
      return parsed;
    };

    if (apiMode === "chat-completions") return translateWithChatCompletions();

    try {
      return await translateWithResponses();
    } catch (error) {
      if (apiMode === "auto" && error instanceof ProviderHttpError && responsesUnavailable(error)) {
        console.warn("[pear:synced-lyrics] Responses endpoint unavailable; falling back to chat/completions");
        return translateWithChatCompletions();
      }
      throw error;
    }
  },
};
