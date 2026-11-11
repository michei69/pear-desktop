import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";

const { theme, received } = vi.hoisted(() => ({
  theme: { dark: false },
  received: [] as string[],
}));

vi.mock("electron", () => ({
  nativeTheme: {
    get shouldUseDarkColors() {
      return theme.dark;
    },
  },
  nativeImage: {
    createFromBuffer: (buffer: Buffer) => {
      const base64 = buffer.toString("base64");
      received.push(base64);
      return { base64 };
    },
  },
}));

const { renderIcons } = await import("../images.ts");

type Rendered = Record<string, { base64: string }>;

const ICONS = ["play", "pause", "next", "previous", "like", "dislike", "likeHollow", "dislikeHollow"];

/** The shipped asset as the `embed` macro hands it over. */
const asset = (color: "black" | "white", name: string) =>
  readFileSync(new URL(`../../../assets/media-icons-${color}/${name}.png`, import.meta.url)).toString("base64");

test("builds every thumbar icon from pear-desktop's PNG assets", () => {
  theme.dark = false;
  received.length = 0;
  const icons = renderIcons() as unknown as Rendered;

  expect(Object.keys(icons).sort()).toEqual([...ICONS].sort());
  expect(icons.play!.base64).toBe(asset("black", "play"));
  expect(icons.pause!.base64).toBe(asset("black", "pause"));
  expect(icons.next!.base64).toBe(asset("black", "next"));
  expect(icons.previous!.base64).toBe(asset("black", "previous"));
  expect(received).toHaveLength(ICONS.length);
});

test("uses the white variants on the dark taskbar", () => {
  theme.dark = true;
  try {
    const icons = renderIcons() as unknown as Rendered;
    expect(icons.play!.base64).toBe(asset("white", "play"));
    expect(icons.previous!.base64).toBe(asset("white", "previous"));
    expect(icons.likeHollow!.base64).toBe(asset("white", "like-hollow"));
  } finally {
    theme.dark = false;
  }
});
