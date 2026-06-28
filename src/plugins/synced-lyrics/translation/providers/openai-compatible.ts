import { net } from 'electron';

import {
  buildSystemPrompt,
  buildUserPrompt,
  parseLinesFromJson,
} from '../prompt';

import type { OpenAICompatibleApiMode } from '../../types';
import type { TranslationProvider } from '../types';

const normalizeChatCompletionsUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
};

const normalizeResponsesUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (/\/responses$/i.test(trimmed)) return trimmed;
  if (/\/chat\/completions$/i.test(trimmed)) {
    return trimmed.replace(/\/chat\/completions$/i, '/responses');
  }
  return `${trimmed}/responses`;
};

const shouldRetryWithoutJsonMode = (status: number, body: string) =>
  status === 400 && /response_format|json_object|text\.format|json/i.test(body);

const shouldRetryWithoutTemperature = (status: number, body: string) =>
  status === 400 && /temperature/i.test(body);

const shouldFallbackToChatCompletions = (status: number, body: string) =>
  [404, 405, 501].includes(status) || /responses/i.test(body);

const extractResponseText = (json: unknown): string => {
  if (
    json &&
    typeof json === 'object' &&
    typeof (json as { output_text?: unknown }).output_text === 'string'
  ) {
    return (json as { output_text: string }).output_text;
  }

  const output = (json as { output?: unknown })?.output;
  if (!Array.isArray(output)) return '';

  return output
    .flatMap((item) => {
      const content = (item as { content?: unknown })?.content;
      return Array.isArray(content) ? content : [];
    })
    .map((part) => {
      if (typeof (part as { text?: unknown })?.text === 'string') {
        return (part as { text: string }).text;
      }
      if (
        typeof (part as { output_text?: unknown })?.output_text === 'string'
      ) {
        return (part as { output_text: string }).output_text;
      }
      return '';
    })
    .join('');
};

export const openAICompatibleProvider: TranslationProvider = {
  name: 'openai-compatible',
  async translate(req, settings) {
    const {
      baseUrl,
      apiKey,
      model,
      apiMode = 'responses',
    } = settings as {
      baseUrl: string;
      apiKey: string;
      model: string;
      apiMode?: OpenAICompatibleApiMode;
    };
    if (!baseUrl) throw new Error('OpenAI-compatible: baseUrl is empty');
    if (!model) throw new Error('OpenAI-compatible: model is empty');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const translateWithResponses = async (): Promise<string[]> => {
      const url = normalizeResponsesUrl(baseUrl);
      const buildBody = (jsonMode: boolean, includeTemperature: boolean) => ({
        model,
        instructions: buildSystemPrompt(req),
        input: buildUserPrompt(req),
        ...(jsonMode ? { text: { format: { type: 'json_object' } } } : {}),
        ...(includeTemperature ? { temperature: 0.3 } : {}),
      });

      console.info('[synced-lyrics] OpenAI-compatible Responses API request', {
        url,
        model,
        lines: req.lines.length,
      });

      const post = (jsonMode: boolean, includeTemperature: boolean) =>
        net.fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(buildBody(jsonMode, includeTemperature)),
        });

      let jsonMode = true;
      let includeTemperature = true;
      let res = await post(jsonMode, includeTemperature);
      let errBody = '';

      if (!res.ok) {
        errBody = await res.text().catch(() => '');
        if (
          includeTemperature &&
          shouldRetryWithoutTemperature(res.status, errBody)
        ) {
          console.warn(
            '[synced-lyrics] Responses endpoint rejected temperature; retrying without temperature',
          );
          includeTemperature = false;
          res = await post(jsonMode, includeTemperature);
          errBody = '';
        } else if (shouldRetryWithoutJsonMode(res.status, errBody)) {
          console.warn(
            '[synced-lyrics] Responses endpoint rejected JSON mode; retrying without text.format',
          );
          jsonMode = false;
          res = await post(jsonMode, includeTemperature);
          errBody = '';
        }
      }

      if (!res.ok) {
        errBody ||= await res.text().catch(() => '');
        const error = new Error(
          `OpenAI-compatible Responses API ${res.status}: ${errBody.slice(
            0,
            300,
          )}`,
        );
        (error as Error & { status?: number; body?: string }).status =
          res.status;
        (error as Error & { status?: number; body?: string }).body = errBody;
        throw error;
      }

      const text = extractResponseText(await res.json());
      const parsed = parseLinesFromJson(text, req.lines.length);
      if (!parsed) {
        throw new Error('Could not parse JSON from Responses API response');
      }
      return parsed;
    };

    const translateWithChatCompletions = async (): Promise<string[]> => {
      const url = normalizeChatCompletionsUrl(baseUrl);
      const buildBody = (jsonMode: boolean, includeTemperature: boolean) => ({
        model,
        messages: [
          { role: 'system', content: buildSystemPrompt(req) },
          { role: 'user', content: buildUserPrompt(req) },
        ],
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        ...(includeTemperature ? { temperature: 0.3 } : {}),
      });

      console.info('[synced-lyrics] OpenAI-compatible API request', {
        url,
        model,
        lines: req.lines.length,
      });

      const post = (jsonMode: boolean, includeTemperature: boolean) =>
        net.fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(buildBody(jsonMode, includeTemperature)),
        });

      let jsonMode = true;
      let includeTemperature = true;
      let res = await post(jsonMode, includeTemperature);
      let errBody = '';

      if (!res.ok) {
        errBody = await res.text().catch(() => '');
        if (
          includeTemperature &&
          shouldRetryWithoutTemperature(res.status, errBody)
        ) {
          console.warn(
            '[synced-lyrics] OpenAI-compatible endpoint rejected temperature; retrying without temperature',
          );
          includeTemperature = false;
          res = await post(jsonMode, includeTemperature);
          errBody = '';
        } else if (shouldRetryWithoutJsonMode(res.status, errBody)) {
          console.warn(
            '[synced-lyrics] OpenAI-compatible endpoint rejected JSON mode; retrying without response_format',
          );
          jsonMode = false;
          res = await post(jsonMode, includeTemperature);
          errBody = '';
        }
      }

      if (!res.ok) {
        errBody ||= await res.text().catch(() => '');
        throw new Error(
          `OpenAI-compatible API ${res.status}: ${errBody.slice(0, 300)}`,
        );
      }

      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = json.choices?.[0]?.message?.content ?? '';
      const parsed = parseLinesFromJson(content, req.lines.length);
      if (!parsed) {
        throw new Error('Could not parse JSON from OpenAI-compatible response');
      }
      return parsed;
    };

    if (apiMode === 'chat-completions') {
      return translateWithChatCompletions();
    }

    try {
      return await translateWithResponses();
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      const body = (err as Error & { body?: string }).body ?? '';
      if (
        apiMode === 'auto' &&
        status &&
        shouldFallbackToChatCompletions(status, body)
      ) {
        console.warn(
          '[synced-lyrics] Responses endpoint unavailable; falling back to chat/completions because apiMode=auto',
        );
        return translateWithChatCompletions();
      }
      throw err;
    }
  },
};
