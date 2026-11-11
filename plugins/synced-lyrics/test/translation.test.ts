import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { lineTextForTranslation } from "../line-text.ts";
import { schema, type LyricsConfig } from "../schema.ts";
import { TranslationService } from "../translation/service.ts";
import { runTranslation } from "../translation/translate.ts";

// Hoisted above the imports, so the service resolves the fake provider call.
vi.mock("../translation/translate.ts", () => ({ runTranslation: vi.fn() }));

const mockedRunTranslation = vi.mocked(runTranslation);
const directories: string[] = [];

const config = (patch: Partial<LyricsConfig> = {}): Readonly<LyricsConfig> => ({
  ...(Object.fromEntries(Object.entries(schema).map(([key, field]) => [key, field.default])) as LyricsConfig),
  ...patch,
});

const translationConfig = (patch: Partial<LyricsConfig> = {}) => config({ translationEnabled: true, ...patch });

async function service(locale = "en") {
  const userData = await mkdtemp(join(tmpdir(), "pear-synced-lyrics-"));
  directories.push(userData);
  return new TranslationService({ userData, locale, fetch: async () => new Response("") });
}

beforeEach(() => {
  // A returned function would be a cleanup hook; keep the mock's own call history separate.
  mockedRunTranslation.mockClear();
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("translation service", () => {
  test("reports a disabled translation instead of calling a provider", async () => {
    const result = await (await service()).translate({ videoId: "abc", title: "Song", artists: ["A"], lines: ["hola"] }, config());
    expect(result).toMatchObject({ lines: [], reason: "disabled" });
    expect(mockedRunTranslation).not.toHaveBeenCalled();
  });

  test("reports no lyrics when there is nothing to translate", async () => {
    const result = await (
      await service()
    ).translate({ videoId: "abc", title: "Song", artists: ["A"], lines: [] }, translationConfig({ translationTargetLanguage: "en" }));
    expect(result).toMatchObject({ lines: [], reason: "no-lyrics" });
  });

  test("reuses a cached translation, and force asks the provider again", async () => {
    mockedRunTranslation.mockResolvedValue(["hello", "friend"]);
    const translations = await service();
    const request = { videoId: "abc", title: "Song", artists: ["A"], lines: ["hola", "amigo"] };
    const settings = translationConfig({ translationTargetLanguage: "en" });

    const first = await translations.translate(request, settings);
    expect(first).toMatchObject({ lines: ["hello", "friend"], provider: "openai-compatible" });
    expect(first.fromCache).toBeUndefined();
    expect(mockedRunTranslation).toHaveBeenCalledTimes(1);

    const cached = await translations.translate(request, settings);
    expect(cached).toMatchObject({ lines: ["hello", "friend"], fromCache: true });
    expect(mockedRunTranslation).toHaveBeenCalledTimes(1);

    const forced = await translations.translate({ ...request, force: true }, settings);
    expect(forced.fromCache).toBeUndefined();
    expect(mockedRunTranslation).toHaveBeenCalledTimes(2);

    const entries = await translations.list("abc");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ sourceLines: ["hola", "amigo"], targetLanguage: "en", model: "gpt-4o-mini" });
  });

  test("a cache key includes the model, so a model change regenerates", async () => {
    mockedRunTranslation.mockResolvedValue(["hello"]);
    const translations = await service();
    const request = { videoId: "abc", title: "Song", artists: ["A"], lines: ["hola"] };

    await translations.translate(request, translationConfig({ translationTargetLanguage: "en", openaiModel: "model-a" }));
    await translations.translate(request, translationConfig({ translationTargetLanguage: "en", openaiModel: "model-b" }));
    expect(mockedRunTranslation).toHaveBeenCalledTimes(2);
  });

  test("skips lyrics already in the target language", async () => {
    const translations = await service("zh-CN");
    const result = await translations.translate(
      {
        videoId: "abc",
        title: "歌",
        artists: ["歌手"],
        lines: ["你好世界，这是我们的歌词", "我们一起唱歌跳舞吧", "今天的天气真的很好"],
      },
      translationConfig({ translationTargetLanguage: "auto" }),
    );
    expect(result).toMatchObject({ sameLanguage: true });
    expect(result.lines).toHaveLength(3);
    expect(mockedRunTranslation).not.toHaveBeenCalled();
  });

  test("reports a provider error as data", async () => {
    mockedRunTranslation.mockImplementation(async () => {
      throw new Error("401 Unauthorized");
    });
    const result = await (
      await service()
    ).translate({ videoId: "abc", title: "Song", artists: ["A"], lines: ["hola"] }, translationConfig({ translationTargetLanguage: "en" }));
    expect(result).toMatchObject({ lines: [], reason: "provider-error", error: "401 Unauthorized" });
  });

  test("rejects an answer with the wrong line count", async () => {
    mockedRunTranslation.mockResolvedValue(["hello"]);
    const result = await (
      await service()
    ).translate(
      { videoId: "abc", title: "Song", artists: ["A"], lines: ["hola", "amigo"] },
      translationConfig({ translationTargetLanguage: "en" }),
    );
    expect(result).toMatchObject({ lines: [], reason: "provider-error" });
  });

  test("clear removes every cached translation", async () => {
    mockedRunTranslation.mockResolvedValue(["hello"]);
    const translations = await service();
    await translations.translate(
      { videoId: "abc", title: "Song", artists: ["A"], lines: ["hola"] },
      translationConfig({ translationTargetLanguage: "en" }),
    );
    await translations.translate(
      { videoId: "def", title: "Other", artists: ["B"], lines: ["adios"] },
      translationConfig({ translationTargetLanguage: "en" }),
    );
    expect(await translations.list("abc")).toHaveLength(1);
    expect(await translations.clear()).toBe(2);
    expect(await translations.list("abc")).toHaveLength(0);
  });
});

describe("line text for translation", () => {
  test("background vocals are translated with their line", () => {
    expect(lineTextForTranslation({ startMs: 0, endMs: 1, text: "I'm too hot" })).toBe("I'm too hot");
    expect(
      lineTextForTranslation({
        startMs: 0,
        endMs: 1,
        text: "I'm too hot",
        background: [{ startMs: 0, endMs: 1, text: "(Hot damn) " }],
      }),
    ).toBe("I'm too hot (Hot damn)");
    expect(
      lineTextForTranslation({
        startMs: 0,
        endMs: 1,
        text: "",
        background: [{ startMs: 0, endMs: 1, text: "ooh" }],
      }),
    ).toBe("ooh");
  });
});
