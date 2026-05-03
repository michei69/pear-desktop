import { net } from 'electron';

import {
  buildSystemPrompt,
  buildUserPrompt,
  parseLinesFromJson,
} from '../prompt';

import type { TranslationProvider } from '../types';

export const geminiProvider: TranslationProvider = {
  name: 'gemini',
  async translate(req, settings) {
    const { apiKey, model } = settings as { apiKey: string; model: string };
    if (!apiKey) throw new Error('Gemini: apiKey is empty');
    if (!model) throw new Error('Gemini: model is empty');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const body = {
      systemInstruction: {
        role: 'system',
        parts: [{ text: buildSystemPrompt(req) }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: buildUserPrompt(req) }],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json',
      },
    };

    const res = await net.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Gemini API ${res.status}: ${errBody.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text =
      json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ??
      '';

    const parsed = parseLinesFromJson(text, req.lines.length);
    if (!parsed) {
      throw new Error('Could not parse JSON from Gemini response');
    }
    return parsed;
  },
};
