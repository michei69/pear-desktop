import { expect, test, vi } from "vitest";
import { artworkImage as shared } from "@pear/sdk/artwork";
import { artworkImage } from "../artwork.ts";

const electron = vi.hoisted(() => ({ fetch: vi.fn(), createFromBuffer: vi.fn() }));

vi.mock("electron", () => ({
  net: { fetch: electron.fetch },
  nativeImage: { createFromBuffer: electron.createFromBuffer },
}));

const response = (body: Buffer) => ({ arrayBuffer: async () => new Uint8Array(body) }) as unknown as Response;
const bytes = (length: number) => Buffer.alloc(length, 1);

/** Empty bytes decode to an empty image, anything else to a decoded one. */
electron.createFromBuffer.mockImplementation((buffer: Buffer) => ({ isEmpty: () => buffer.byteLength === 0 }));

test("the Touch Bar uses the shared host artwork cache, not a second decoder", () => {
  expect(artworkImage).toBe(shared);
});

test("a repeated track is decoded once through it", async () => {
  electron.fetch.mockImplementation(async () => response(bytes(2)));
  const [first, second] = [
    artworkImage("https://i.ytimg.com/vi/abc/hqdefault.jpg"),
    artworkImage("https://i.ytimg.com/vi/abc/hqdefault.jpg"),
  ];
  expect(second).toBe(first);
  expect(await first).toBe(await second);
  expect(electron.fetch).toHaveBeenCalledTimes(1);
});
