import { definePlugin, type LikeStatus, type NowPlaying } from "@pear/sdk";
import { embed } from "@pear/sdk/macros" with { type: "macro" };
import { isPlaying } from "@pear/sdk/util";
import { nativeImage, nativeTheme, type NativeImage, type ThumbarButton } from "electron";

type Point = readonly [number, number];
type DrawnIcon = "play" | "pause" | "next" | "previous";
type ThumbIcon = "like" | "dislike" | "likeHollow" | "dislikeHollow";
type Icon = DrawnIcon | ThumbIcon;
type Icons = Record<Icon, NativeImage>;

// Glyphs as polygons in a 16×16 design space, rasterized in code so no asset files are needed.
const DESIGN_SIZE = 16;
const GLYPHS: Record<DrawnIcon, Point[][]> = {
  play: [
    [
      [4, 2.5],
      [13.5, 8],
      [4, 13.5],
    ],
  ],
  pause: [
    [
      [3.5, 2.5],
      [6.5, 2.5],
      [6.5, 13.5],
      [3.5, 13.5],
    ],
    [
      [9.5, 2.5],
      [12.5, 2.5],
      [12.5, 13.5],
      [9.5, 13.5],
    ],
  ],
  next: [
    [
      [2.5, 2.5],
      [10.5, 8],
      [2.5, 13.5],
    ],
    [
      [11, 2.5],
      [13.5, 2.5],
      [13.5, 13.5],
      [11, 13.5],
    ],
  ],
  previous: [
    [
      [13.5, 2.5],
      [5.5, 8],
      [13.5, 13.5],
    ],
    [
      [2.5, 2.5],
      [5, 2.5],
      [5, 13.5],
      [2.5, 13.5],
    ],
  ],
};

/** The buttons' bitmap size: 16 px at scale factor 2. */
const SIZE = 32;
const SAMPLES = 4;

// pear-desktop's thumbs, embedded at build time (base64) in both taskbar colors,
// so pressed and hollow states match the fork exactly without ?asset imports.
const THUMB_ICONS: Record<ThumbIcon, { black: string; white: string }> = {
  like: {
    black: embed("media-icons-black/like.png"),
    white: embed("media-icons-white/like.png"),
  },
  dislike: {
    black: embed("media-icons-black/dislike.png"),
    white: embed("media-icons-white/dislike.png"),
  },
  likeHollow: {
    black: embed("media-icons-black/like-hollow.png"),
    white: embed("media-icons-white/like-hollow.png"),
  },
  dislikeHollow: {
    black: embed("media-icons-black/dislike-hollow.png"),
    white: embed("media-icons-white/dislike-hollow.png"),
  },
};

export default definePlugin({
  id: "taskbar-mediacontrol",
  name: "Taskbar media controls",
  description: "Like, dislike and playback buttons in the window's taskbar thumbnail.",
  platforms: ["win32"],
  host: {
    start(ctx) {
      const { window } = ctx;
      let icons = renderIcons();
      // What the thumbar currently shows; Win32 wants the whole list rewritten,
      // so anything unchanged must not reach setThumbarButtons or it flickers.
      let shown: { playing: boolean; like: LikeStatus; icons: Icons } | undefined;
      let hasButtons = false;

      const update = (state: NowPlaying = ctx.player.state, force = false) => {
        if (window.isDestroyed()) return;
        // Nothing to control until a track is loaded.
        if (!state.track) {
          shown = undefined;
          if (!hasButtons) return;
          hasButtons = false;
          window.setThumbarButtons([]);
          return;
        }
        const playing = isPlaying(state);
        const like = state.like;
        if (!force && shown && shown.icons === icons && shown.playing === playing && shown.like === like) return;
        shown = { playing, like, icons };
        hasButtons = true;

        const likeIcon = like === "like" ? icons.like : icons.likeHollow;
        const dislikeIcon = like === "dislike" ? icons.dislike : icons.dislikeHollow;
        const buttons: ThumbarButton[] = [
          {
            tooltip: ctx.t("plugins.taskbar-mediacontrol.dislike", "Dislike"),
            icon: dislikeIcon,
            // The page sets the rating (re-disliking clears it).
            click: () => ctx.player.control({ type: "dislike" }),
          },
          { tooltip: ctx.t("main.tray.previous", "Previous"), icon: icons.previous, click: () => ctx.player.control({ type: "previous" }) },
          {
            tooltip: playing ? ctx.t("plugins.taskbar-mediacontrol.pause", "Pause") : ctx.t("plugins.taskbar-mediacontrol.play", "Play"),
            icon: playing ? icons.pause : icons.play,
            click: () => ctx.player.control({ type: "toggle" }),
          },
          { tooltip: ctx.t("main.tray.next", "Next"), icon: icons.next, click: () => ctx.player.control({ type: "next" }) },
          {
            tooltip: ctx.t("plugins.taskbar-mediacontrol.like", "Like"),
            icon: likeIcon,
            click: () => ctx.player.control({ type: "like" }),
          },
        ];
        window.setThumbarButtons(buttons);
      };

      // One listener: `update` itself skips the unchanged renders (position
      // updates arrive every second; a rating change redraws the thumbs).
      ctx.player.on("change", (state) => update(state));
      const onTheme = () => {
        icons = renderIcons();
        update(undefined, true);
      };
      ctx.listen(nativeTheme, "updated", onTheme);
      // Windows forgets the buttons when the window is hidden.
      ctx.listen(window, "show", () => update(undefined, true));
      update();
      ctx.onCleanup(() => {
        if (!window.isDestroyed()) window.setThumbarButtons([]);
      });
    },
  },
});

function renderIcons(): Icons {
  const dark = nativeTheme.shouldUseDarkColors;
  const color: [number, number, number] = dark ? [255, 255, 255] : [0, 0, 0];
  const drawn = (Object.keys(GLYPHS) as DrawnIcon[]).map((name) => [
    name,
    nativeImage.createFromBitmap(rasterize(GLYPHS[name], color), { width: SIZE, height: SIZE, scaleFactor: 2 }),
  ]);
  const thumbs = (Object.keys(THUMB_ICONS) as ThumbIcon[]).map((name) => [
    name,
    nativeImage.createFromBuffer(Buffer.from(dark ? THUMB_ICONS[name].white : THUMB_ICONS[name].black, "base64")),
  ]);
  return Object.fromEntries([...drawn, ...thumbs]) as Icons;
}

/** BGRA, premultiplied, antialiased by supersampling. */
function rasterize(polygons: Point[][], [r, g, b]: [number, number, number]) {
  const buffer = Buffer.alloc(SIZE * SIZE * 4);
  const scale = DESIGN_SIZE / SIZE;
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) * scale;
          const y = (py + (sy + 0.5) / SAMPLES) * scale;
          if (polygons.some((polygon) => inside(polygon, x, y))) hits++;
        }
      }
      const alpha = hits / (SAMPLES * SAMPLES);
      const offset = (py * SIZE + px) * 4;
      buffer[offset] = Math.round(b * alpha);
      buffer[offset + 1] = Math.round(g * alpha);
      buffer[offset + 2] = Math.round(r * alpha);
      buffer[offset + 3] = Math.round(255 * alpha);
    }
  }
  return buffer;
}

function inside(polygon: Point[], x: number, y: number) {
  // Even-odd rule: count the edges a ray to the right crosses.
  let result = false;
  for (let i = 0; i < polygon.length; i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[(i + polygon.length - 1) % polygon.length]!;
    const spansY = yi > y !== yj > y;
    if (spansY && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) result = !result;
  }
  return result;
}
