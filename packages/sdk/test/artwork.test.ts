import { beforeEach, describe, expect, test, vi } from "vitest";

const electron = vi.hoisted(() => {
  const empty = { isEmpty: () => true };
  return { empty, fetch: vi.fn(), createFromBuffer: vi.fn(), createEmpty: vi.fn(() => empty) };
});

vi.mock("electron", () => ({
  net: { fetch: electron.fetch },
  nativeImage: { createFromBuffer: electron.createFromBuffer, createEmpty: electron.createEmpty },
}));

interface FakeImage {
  isEmpty(): boolean;
}

/** Empty bytes decode to an empty image, anything else to a decoded one. */
electron.createFromBuffer.mockImplementation((buffer: Buffer): FakeImage =>
  buffer.byteLength === 0 ? electron.empty : { isEmpty: () => false },
);

const response = (body: Buffer) => ({ arrayBuffer: async () => new Uint8Array(body) }) as unknown as Response;
const bytes = (length: number) => Buffer.alloc(length, 1);
const load = () => import("../src/artwork.ts");

beforeEach(() => {
  // The cache is module state: a fresh module keeps the LRU tests independent.
  vi.resetModules();
  electron.fetch.mockReset();
});

describe("shared decoded artwork", () => {
  test("the query string is stripped before fetching and cache lookups", async () => {
    const { artworkImage } = await load();
    electron.fetch.mockImplementation(async () => response(bytes(2)));
    await artworkImage("https://i.ytimg.com/vi/abc/hqdefault.jpg?sqp=one");
    await artworkImage("https://i.ytimg.com/vi/abc/hqdefault.jpg?sqp=two");
    expect(electron.fetch.mock.calls.map(([url]) => url)).toEqual(["https://i.ytimg.com/vi/abc/hqdefault.jpg"]);
  });

  test("a webp behind a .jpg path is retried truncated at the last .jpg (pear-desktop#315)", async () => {
    const { artworkImage } = await load();
    electron.fetch.mockImplementation(async (url: string) => (url.endsWith(".webp") ? response(Buffer.alloc(0)) : response(bytes(2))));
    const image = await artworkImage("https://i.ytimg.com/vi/abc/hqdefault.jpg.webp");
    expect(electron.fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://i.ytimg.com/vi/abc/hqdefault.jpg.webp",
      "https://i.ytimg.com/vi/abc/hqdefault.jpg",
    ]);
    expect(image.isEmpty()).toBe(false);
  });

  test("a URL whose retry is empty too resolves empty, so the app icon stands in", async () => {
    const { artworkImage } = await load();
    electron.fetch.mockImplementation(async () => response(Buffer.alloc(0)));
    expect((await artworkImage("https://i.ytimg.com/vi/empty/hqdefault.jpg.webp")).isEmpty()).toBe(true);
    expect(electron.fetch).toHaveBeenCalledTimes(2);
  });

  test("a plain .jpg URL is not retried when it decodes empty", async () => {
    const { artworkImage } = await load();
    electron.fetch.mockImplementation(async () => response(Buffer.alloc(0)));
    expect((await artworkImage("https://i.ytimg.com/vi/empty/hqdefault.jpg")).isEmpty()).toBe(true);
    expect(electron.fetch).toHaveBeenCalledTimes(1);
  });

  test("concurrent callers share one fetch, so every consumer gets the same image", async () => {
    const { artworkImage } = await load();
    electron.fetch.mockImplementation(async () => response(bytes(3)));
    const [first, second] = await Promise.all([artworkImage("https://art.example/one.jpg"), artworkImage("https://art.example/one.jpg")]);
    expect(second).toBe(first);
    expect(electron.fetch).toHaveBeenCalledTimes(1);
  });

  test("only the ten most recently used covers stay decoded", async () => {
    const { artworkImage } = await load();
    electron.fetch.mockImplementation(async () => response(bytes(3)));
    for (let index = 0; index < 11; index += 1) await artworkImage(`https://art.example/lru-${index}.jpg`);
    expect(electron.fetch).toHaveBeenCalledTimes(11);
    // The oldest was evicted, the newest was not.
    await artworkImage("https://art.example/lru-0.jpg");
    expect(electron.fetch).toHaveBeenCalledTimes(12);
    await artworkImage("https://art.example/lru-10.jpg");
    expect(electron.fetch).toHaveBeenCalledTimes(12);
  });

  test("a failed fetch is not cached, so a retry can succeed", async () => {
    const { artworkImage } = await load();
    electron.fetch.mockRejectedValueOnce(new Error("offline")).mockImplementation(async () => response(bytes(3)));
    await expect(artworkImage("https://art.example/flaky.jpg")).rejects.toThrow("offline");
    expect((await artworkImage("https://art.example/flaky.jpg")).isEmpty()).toBe(false);
    expect(electron.fetch).toHaveBeenCalledTimes(2);
  });
});
