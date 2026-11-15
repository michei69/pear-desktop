import { beforeEach, describe, expect, test, vi } from "vitest";

import { runTranslation } from "../translation/translate.ts";
import { translationProviders } from "../translation/providers/index.ts";

// Hoisted above the imports, so the service resolves the fake provider.
vi.mock("../translation/providers/index.ts", () => ({
  translationProviders: { "openai-compatible": { name: "openai-compatible", translate: vi.fn() } },
}));

const provider = vi.mocked(translationProviders["openai-compatible"]);
const settings = { baseUrl: "https://example.test/v1", apiKey: "key", model: "model" };
const env = { fetch: async () => new Response(""), userData: "/tmp" };
const lines = (count: number) => Array.from({ length: count }, (_, i) => `line ${i + 1}`);

beforeEach(() => {
  // A returned function in a hook would be run as cleanup; keep the reset braced.
  provider.translate.mockReset();
});

describe("per-line fallback", () => {
  test("a hard provider error on a long song surfaces at once", async () => {
    provider.translate.mockRejectedValue(new Error("401 Unauthorized"));
    await expect(runTranslation("openai-compatible", settings, request(lines(20)), env)).rejects.toThrow("401");
    // One whole-song request, no per-line storm.
    expect(provider.translate).toHaveBeenCalledTimes(1);
  });

  test("a wrong line count is retried line by line", async () => {
    provider.translate.mockImplementation(async (req) => (req.lines.length > 1 ? ["only one"] : [`translated ${req.lines[0]}`]));
    const output = await runTranslation("openai-compatible", settings, request(lines(20)), env);
    expect(output).toHaveLength(20);
    expect(output[0]).toBe("translated line 1");
    // Two whole-song attempts, then one request per line.
    expect(provider.translate).toHaveBeenCalledTimes(22);
  });

  test("a short song still falls back per line on a hard error", async () => {
    provider.translate.mockImplementation(async (req) => {
      if (req.lines.length > 1) throw new Error("503 Service Unavailable");
      return [`translated ${req.lines[0]}`];
    });
    const output = await runTranslation("openai-compatible", settings, request(lines(3)), env);
    expect(output).toEqual(["translated line 1", "translated line 2", "translated line 3"]);
    expect(provider.translate).toHaveBeenCalledTimes(4);
  });
});

function request(sourceLines: string[]) {
  return {
    title: "Song",
    artists: ["Artist"],
    targetLanguage: "en",
    resolvedTargetLanguage: "en",
    lines: sourceLines,
  };
}
