import { afterEach, describe, expect, test, vi } from "vitest";
import { artwork } from "../artwork.ts";

const electron = vi.hoisted(() => ({ fetch: vi.fn(), createFromBuffer: vi.fn() }));

vi.mock("electron", () => ({
  net: { fetch: electron.fetch },
  nativeImage: { createFromBuffer: electron.createFromBuffer },
}));

interface FakeImage {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  crop(rect: Electron.Rectangle): FakeImage;
  resize(options: Electron.ResizeOptions): FakeImage;
}

const empty: FakeImage = {
  isEmpty: () => true,
  getSize: () => ({ width: 0, height: 0 }),
  crop: () => empty,
  resize: () => empty,
};

/** non-empty bytes decode to a 400x300 "cover"; empty ones to an empty image. */
electron.createFromBuffer.mockImplementation((buffer: Buffer): FakeImage => {
  if (buffer.byteLength === 0) return empty;
  const image: FakeImage = {
    isEmpty: () => false,
    getSize: () => ({ width: 400, height: 300 }),
    crop: vi.fn(),
    resize: vi.fn(),
  };
  image.crop = vi.fn(() => image);
  image.resize = vi.fn(() => image);
  return image;
});

const response = (body: Buffer) => ({ arrayBuffer: async () => new Uint8Array(body) }) as unknown as Response;
const bytes = (length: number) => Buffer.alloc(length, 1);

afterEach(() => {
  electron.fetch.mockReset();
});

describe("notification artwork", () => {
  test("the cover is fetched and decoded once for repeated notifications", async () => {
    electron.fetch.mockImplementation(async () => response(bytes(4)));
    await artwork("https://art.example/shared.jpg");
    await artwork("https://art.example/shared.jpg");
    expect(electron.fetch).toHaveBeenCalledTimes(1);
  });

  test("the square styles crop the cover to its center", async () => {
    electron.fetch.mockImplementation(async () => response(bytes(4)));
    const cropped = await artwork("https://art.example/crop.jpg");
    expect(cropped).toBeDefined();
    expect(vi.mocked(cropped!.crop)).toHaveBeenCalledWith({ x: 50, y: 0, width: 300, height: 300 });
    expect(vi.mocked(cropped!.resize)).toHaveBeenCalledWith({ width: 256, height: 256, quality: "best" });
  });

  test("the banner styles keep the cover as decoded", async () => {
    electron.fetch.mockImplementation(async () => response(bytes(4)));
    const banner = await artwork("https://art.example/banner.jpg", false);
    expect(vi.mocked(banner!.crop)).not.toHaveBeenCalled();
  });

  test("missing, empty and failing artwork resolves undefined", async () => {
    expect(await artwork(undefined)).toBeUndefined();
    electron.fetch.mockImplementation(async () => response(Buffer.alloc(0)));
    expect(await artwork("https://art.example/no-id.jpg")).toBeUndefined();
    electron.fetch.mockImplementation(async () => Promise.reject(new Error("offline")));
    expect(await artwork("https://art.example/broken.jpg")).toBeUndefined();
  });
});
