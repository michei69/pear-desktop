import { beforeEach, describe, expect, test, vi } from "vitest";

const log = { warn: vi.fn() };

let albumColors: typeof import("./artwork.ts").albumColors;

// The cache lives at module scope; a fresh module per test keeps them apart.
beforeEach(async () => {
  vi.resetModules();
  log.warn.mockClear();
  ({ albumColors } = await import("./artwork.ts"));
});

const black = { color: [0, 0, 0], dark: [0, 0, 0] };

describe("albumColors", () => {
  test("artwork that fails to download or decode tints black", async () => {
    const sample = vi.fn((_url: string) => Promise.reject(new Error("tainted canvas")));

    await expect(albumColors("https://artwork.test/fail", log, sample)).resolves.toEqual(black);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  test("a failed artwork is not remembered, so a later request retries", async () => {
    const failing = vi.fn((_url: string) => Promise.reject(new Error("offline")));
    await albumColors("https://artwork.test/retry", log, failing);

    const recovered = vi.fn(async () => [200, 100, 50] as const);
    const colors = await albumColors("https://artwork.test/retry", log, recovered);

    expect(recovered).toHaveBeenCalledOnce();
    expect(colors.color).not.toEqual([0, 0, 0]);
  });

  test("a transparent artwork tints black and stays cached", async () => {
    const sample = vi.fn(async () => undefined);

    expect(await albumColors("https://artwork.test/transparent", log, sample)).toEqual(black);
    expect(await albumColors("https://artwork.test/transparent", log, sample)).toEqual(black);
    expect(sample).toHaveBeenCalledOnce();
  });

  test("the cache keeps the 100 most recent artworks", async () => {
    const sample = vi.fn(async () => undefined);
    for (let index = 0; index <= 100; index++) await albumColors(`https://artwork.test/lru/${index}`, log, sample);
    expect(sample).toHaveBeenCalledTimes(101);

    const cached = vi.fn(async () => undefined);
    await albumColors("https://artwork.test/lru/100", log, cached);
    expect(cached).not.toHaveBeenCalled();
    // The oldest entry was evicted; the whole cache is not dropped.
    await albumColors("https://artwork.test/lru/0", log, cached);
    expect(cached).toHaveBeenCalledOnce();
  });

  test("a cache hit moves the artwork to the most recently used end", async () => {
    const sample = vi.fn(async () => undefined);
    for (let index = 0; index < 100; index++) await albumColors(`https://artwork.test/recency/${index}`, log, sample);
    await albumColors("https://artwork.test/recency/0", log, sample);
    expect(sample).toHaveBeenCalledTimes(100);
    await albumColors("https://artwork.test/recency/100", log, sample);

    const cached = vi.fn(async () => undefined);
    await albumColors("https://artwork.test/recency/1", log, cached);
    expect(cached).toHaveBeenCalledOnce();
    await albumColors("https://artwork.test/recency/0", log, cached);
    expect(cached).toHaveBeenCalledOnce();
  });
});
