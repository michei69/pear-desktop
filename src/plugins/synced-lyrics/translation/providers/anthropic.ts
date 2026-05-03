import { net } from 'electron';

import {
  buildSystemPrompt,
  buildUserPrompt,
  parseLinesFromJson,
} from '../prompt';

import type { TranslationProvider } from '../types';

export const anthropicProvider: TranslationProvider = {
  name: 'anthropic',
  async translate(req, settings) {
    const { apiKey, model } = settings as { apiKey: string; model: string };
    if (!apiKey) throw new Error('Anthropic: apiKey is empty');
    if (!model) throw new Error('Anthropic: model is empty');

    const body = {
      model,
      max_tokens: 4096,
      system: buildSystemPrompt(req),
      messages: [
        { role: 'user', content: buildUserPrompt(req) },
        // Prefill the assistant turn with the start of a JSON object so the
        // model continues from "{" — gives more reliable JSON output.
        { role: 'assistant', content: '{' },
      ],
      temperature: 0.3,
    };

    const res = await net.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Anthropic API ${res.status}: ${errBody.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      content?: { type?: string; text?: string }[];
    };
    const text =
      json.content
        ?.filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('') ?? '';

    // Re-add the prefill `{` we sent.
    const fullJson = '{' + text;
    const parsed = parseLinesFromJson(fullJson, req.lines.length);
    if (!parsed) {
      throw new Error('Could not parse JSON from Anthropic response');
    }
    return parsed;
  },
};
