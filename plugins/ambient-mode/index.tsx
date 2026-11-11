/** @jsxImportSource @pear/sdk */
import { config, definePlugin, type PageContextOf } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };
import { mountAmbientLight, type AmbientLightConfig } from "./ambient-light.ts";

// Until the video reports its size.
const DEFAULT_ASPECT = 9 / 16;

const schema = {
  style: config.select(
    "standard",
    [
      { value: "standard", label: "Standard" },
      { value: "ambilight", label: "Ambilight" },
    ],
    { label: "Style", description: "Choose how the ambient light is drawn.", group: "General" },
  ),
  interpolationTime: config.number(1500, {
    label: "Transition smoothness",
    description: "How long the glow takes to follow the video.",
    min: 0,
    max: 5000,
    step: 100,
    unit: "ms",
    group: "General",
  }),
  quality: config.number(50, { label: "Quality", min: 10, max: 1000, step: 10, unit: "px", group: "General" }),
  size: config.number(100, { label: "Size", min: 100, max: 300, step: 5, unit: "%", group: "General" }),
  buffer: config.number(30, { label: "Frame rate", min: 1, max: 60, step: 1, unit: "fps", group: "General" }),
  opacity: config.number(100, { label: "Opacity", min: 0, max: 100, step: 5, unit: "%", group: "General" }),
  blur: config.number(100, { label: "Blur", min: 0, max: 500, step: 5, unit: "px", group: "General" }),
  extendSidebar: config.bool(false, {
    label: "Extend past the sidebar",
    description: "Let the glow run under the sidebar instead of beside it, dropping the sidebar's background.",
    group: "General",
  }),
  fullscreen: config.bool(false, {
    label: "Fill the window",
    description: "Let the video's glow cover the whole player page.",
    group: "General",
  }),
  barDetection: config.bool(true, {
    label: "Ignore black bars",
    description: "Skips black letterbox and pillarbox bars when drawing the ambilight.",
    group: "Ambilight",
  }),
  brightness: config.number(100, { label: "Brightness", min: 0, max: 200, step: 5, unit: "%", group: "Ambilight" }),
  contrast: config.number(100, { label: "Contrast", min: 0, max: 200, step: 5, unit: "%", group: "Ambilight" }),
  saturation: config.number(100, { label: "Saturation", min: 0, max: 200, step: 5, unit: "%", group: "Ambilight" }),
  theme: config.select(
    "auto",
    [
      { value: "auto", label: "Auto" },
      { value: "light", label: "Light" },
      { value: "dark", label: "Dark" },
    ],
    {
      label: "Theme",
      description: "Tone mixed over the ambilight to keep the page readable.",
      group: "Ambilight",
    },
  ),
  dimming: config.number(0, {
    label: "Dimming",
    description: "How strongly the theme tone covers the ambilight.",
    min: 0,
    max: 100,
    step: 5,
    unit: "%",
    group: "Ambilight",
  }),
  fadeStart: config.number(100, {
    label: "Fade out start",
    description: "Where the ambilight starts fading toward the page edges (100%: no fade).",
    min: 0,
    max: 100,
    step: 5,
    unit: "%",
    group: "Ambilight",
  }),
  fadeCurve: config.number(50, {
    label: "Fade out curve",
    description: "Shape of the fade toward the page edges.",
    min: 1,
    max: 100,
    step: 1,
    unit: "%",
    group: "Ambilight",
  }),
  fadeIn: config.number(0, { label: "Fade in duration", min: 0, max: 5, step: 0.5, unit: "s", group: "Ambilight" }),
  sync: config.select(
    "video",
    [
      { value: "decoded", label: "Decoded" },
      { value: "display", label: "Display" },
      { value: "video", label: "Video" },
    ],
    {
      label: "Synchronization",
      description: "Decoded: one timer. Display: the screen refresh. Video: the video's own frame callbacks.",
      group: "Ambilight",
    },
  ),
  energySaver: config.bool(false, {
    label: "Save energy on static videos",
    description: "Skips redraws while the video frame does not change.",
    group: "Ambilight",
  }),
};

type Ctx = PageContextOf<typeof schema>;
type GlowKind = "video" | "image";

export default definePlugin({
  id: "ambient-mode",
  name: "Ambient mode",
  description: "Surrounds the video or cover art with a soft glow of its own colors.",
  config: schema,
  style: css`
    .pear-ambient {
      position: absolute;
      left: 50%;
      top: 50%;
      width: var(--pear-ambient-size, 100%);
      height: var(--pear-ambient-size, 100%);
      transform: translate(-50%, -50%);
      filter: blur(var(--pear-ambient-blur, 100px));
      opacity: var(--pear-ambient-opacity, 1);
      object-fit: cover;
      pointer-events: none;
    }
    canvas.pear-ambient.fullscreen {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      transform: none;
    }
    sel(player.song_video) .html5-video-container {
      height: 100%;
    }
    sel(player.video_container) {
      height: 100%;
    }
    sel(player.container):not([video-mode]):not(.video-mode):not([player-ui-state='MINIPLAYER']):not([is-mweb-modernization-enabled]) {
      width: 100%;
      margin: 0 auto !important;
      overflow: visible;
    }
    sel(player.side_panel) {
      z-index: 0;
    }
    sel(player.av_toggle) {
      z-index: 1;
    }
    .song-button.ytmusic-av-toggle,
    .video-button.ytmusic-av-toggle {
      background-color: transparent;
    }
    /* Let the glow show through the sidebar by dropping its background. */
    body.ambient-mode-extend-sidebar tp-yt-app-drawer div#contentContainer,
    body.ambient-mode-extend-sidebar ytmusic-app #guide-wrapper.ytmusic-app,
    body.ambient-mode-extend-sidebar #mini-guide-background {
      background: transparent !important;
    }
    body.ambient-mode-extend-sidebar ytmusic-app-layout:not([is-contained-content-layout-enabled]) > #content {
      padding-bottom: 0;
    }
    body.ambient-mode-extend-sidebar ytmusic-app-layout:not([is-mweb-modernization-enabled]) > [slot='player-page'] {
      /* Place the player beneath the guide, not next to it. */
      left: 0 !important;
      padding-left: var(--ytmusic-guide-width);
    }

    /* Ambilight: a full-page canvas painted from the frame's border colours. */
    .ambient-mode-canvas {
      position: fixed;
      inset: 0;
      z-index: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      filter: blur(var(--blur, 100px)) brightness(var(--brightness, 100%)) contrast(var(--contrast, 100%))
        saturate(var(--saturation, 100%));
      opacity: var(--opacity, 1);
      /* Bleed the blurred edges out of the viewport. */
      transform: scale(1.15);
      animation: ambient-mode-fade-in var(--fade-in, 0s) ease-out;
    }
    /* Fades the wash toward the page edges, around the player. */
    .ambient-mode-canvas.ambient-mode-canvas--fade {
      mask-image: radial-gradient(
        circle at var(--ambient-center, 50% 50%),
        #000 var(--fade-start, 100%),
        var(--fade-hint, 50%),
        transparent
      );
    }
    /* Mixed over the ambilight, underneath the page content, so text keeps its contrast. */
    .ambient-mode-scrim {
      position: fixed;
      inset: 0;
      z-index: 0;
      pointer-events: none;
      background-color: var(--fill-color, transparent);
      opacity: var(--dimming, 0);
      animation: ambient-mode-fade-in var(--fade-in, 0s) ease-out;
    }
    @keyframes ambient-mode-fade-in {
      from {
        opacity: 0;
      }
    }
    /* The layer only shows through a transparent player page. */
    body.ambient-mode-page sel(player.page) {
      background-color: transparent !important;
    }
  `,
  host: {
    start(ctx) {
      // Master's radio submenus can't be rebuilt in the flat menu; a shortcut to the card can.
      ctx.addMenuItem({
        label: ctx.t("plugins.ambient-mode.menu.open-settings", "Ambient mode settings"),
        click: () => ctx.openSettings(),
      });
    },
  },
  page(ctx) {
    let style = ctx.config.style;
    let glow: Glow | null = null;

    const setExtendSidebar = (enabled: boolean) => document.body.classList.toggle("ambient-mode-extend-sidebar", enabled);
    setExtendSidebar(ctx.config.extendSidebar);
    ctx.onCleanup(() => {
      setExtendSidebar(false);
      glow?.remove();
      glow = null;
    });

    const sync = () => {
      if (ctx.signal.aborted) return;
      const wanted = wantedGlow(ctx);
      if (glowKey(wanted) === glowKey(glow)) return;
      glow?.remove();
      glow = null;
      if (!wanted) return;
      glow =
        ctx.config.style === "ambilight"
          ? mountAmbilight(ctx, wanted)
          : wanted.kind === "video"
            ? mountVideo(ctx, wanted)
            : mountImage(ctx, wanted);
    };

    // These are the only inputs that change what should be drawn: re-injecting
    // on each is what used to need a 1 s poll. Only the roots are watched -
    // never a subtree holding the injected elements - so the styles this
    // plugin writes cannot feed back into the observers.
    ctx.observe("app.layout", { attributes: true, attributeFilter: ["player-page-open"] }, sync);
    ctx.observe("player.page", { attributes: true, attributeFilter: ["style"] }, sync);
    ctx.observe("player.song_video", { attributes: true, attributeFilter: ["style"] }, sync);
    ctx.observe("player.song_image_img", { attributes: true, attributeFilter: ["src"] }, sync);
    ctx.observe("player.container", { attributes: true, attributeFilter: ["playable", "playback-mode", "video-mode"] }, sync);
    ctx.player.on("trackChange", sync);
    ctx.player.on("statusChange", sync);
    // YTM adds the <video> a little after the player API, so its first source
    // change is not observed yet.
    void ctx.player.videoReady().then(sync, () => {});
    // Everything above only fires on later changes: sync the current state once.
    sync();
    void ctx.waitFor("player.page").then(sync, () => {});

    // Config changes apply in place; only the style switch rebuilds the glow.
    ctx.onConfigChange((next) => {
      setExtendSidebar(next.extendSidebar);
      if (next.style !== style) {
        style = next.style;
        glow?.remove();
        glow = null;
        sync();
        return;
      }
      glow?.update();
    });
  },
});

interface Glow {
  kind: GlowKind;
  source: string;
  /** Config changed without the style switching: rewrite what can be rewritten in place. */
  update(): void;
  remove(): void;
}

/** What the glow should follow right now: nothing while the player page is closed. */
function wantedGlow(ctx: Ctx): { kind: GlowKind; source: string } | null {
  const open = ctx.$("app.layout")?.hasAttribute("player-page-open") ?? false;
  if (!open) return null;
  const songVideo = ctx.$("player.song_video");
  const isVideo = !!songVideo && getComputedStyle(songVideo).display !== "none";
  if (isVideo) {
    const video = ctx.player.video();
    return video ? { kind: "video", source: video.src } : null;
  }
  const source = ctx.$<HTMLImageElement>("player.song_image_img")?.src ?? "";
  // YTM shows a transparent placeholder until the artwork loads.
  return source && !source.startsWith("data:") ? { kind: "image", source } : null;
}

const glowKey = (glow: { kind: GlowKind; source: string } | null) => (glow ? `${glow.kind} ${glow.source}` : "");

const applyStyle = (ctx: Ctx, element: HTMLElement) => {
  element.style.setProperty("--pear-ambient-size", `${ctx.config.size}%`);
  element.style.setProperty("--pear-ambient-blur", `${ctx.config.blur}px`);
  element.style.setProperty("--pear-ambient-opacity", `${ctx.config.opacity / 100}`);
};

/** The ambilight renderer's view of the config. */
const ambientConfig = (config: Ctx["config"]): AmbientLightConfig => ({
  quality: config.quality,
  fps: config.buffer,
  interpolationTime: config.interpolationTime,
  blur: config.blur,
  // The settings card keeps master's percent, the renderer master's fraction.
  opacity: config.opacity / 100,
  barDetection: config.barDetection,
  brightness: config.brightness,
  contrast: config.contrast,
  saturation: config.saturation,
  theme: config.theme,
  dimming: config.dimming,
  fadeStart: config.fadeStart,
  fadeCurve: config.fadeCurve,
  fadeIn: config.fadeIn,
  sync: config.sync,
  energySaver: config.energySaver,
});

/** Master's ambilight: the frame's edge colours stretched over the whole page. */
function mountAmbilight(ctx: Ctx, wanted: { kind: GlowKind; source: string }): Glow | null {
  const source = wanted.kind === "video" ? ctx.player.video() : ctx.$<HTMLImageElement>("player.song_image_img");
  if (!source) return null;
  const ambient = mountAmbientLight(source, {
    getConfig: () => ambientConfig(ctx.config),
    page: ctx.$("player.page"),
    isVisible: () => ctx.isWindowVisible(),
  });
  return { kind: wanted.kind, source: wanted.source, update: ambient.refresh, remove: ambient.unregister };
}

/** A blurred copy of the cover art; returns nothing if there is no artwork yet. */
function mountImage(ctx: Ctx, wanted: { kind: GlowKind; source: string }): Glow | null {
  const container = ctx.$("player.song_image");
  const source = ctx.$<HTMLImageElement>("player.song_image_img");
  // YTM shows a transparent placeholder until the artwork loads.
  if (!container || !source || source.src.startsWith("data:")) return null;
  const image = <img class="pear-ambient" alt="" src={source.src} />;
  const update = () => applyStyle(ctx, image);
  update();
  container.prepend(image);
  return { kind: wanted.kind, source: wanted.source, update, remove: () => image.remove() };
}

/** A small canvas painted from the video; returns nothing if there is no video. */
function mountVideo(ctx: Ctx, wanted: { kind: GlowKind; source: string }): Glow | null {
  const wrapper = ctx.$("player.song_video_wrapper");
  const video = ctx.player.video();
  if (!wrapper || !video) return null;
  const canvas = (<canvas class="pear-ambient" />) as HTMLCanvasElement;
  const context = canvas.getContext("2d");
  if (!context) return null;

  // The canvas is never cleared, so the previous frame's pixels already sit
  // underneath. Drawing the new frame at partial alpha over them blends it
  // into a trailing motion blur without a CPU pixel readback. globalAlpha
  // silently ignores values outside [0, 1], so interpolationTime 0 maps to 1.
  let hasDrawnOnce = false;
  const draw = () => {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !ctx.isWindowVisible()) return;
    context.globalAlpha = hasDrawnOnce ? Math.min(blendAlpha(ctx), 1) : 1;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    hasDrawnOnce = true;
  };

  const resize = () => {
    const width = ctx.config.quality;
    const aspect = video.videoHeight && video.videoWidth ? video.videoHeight / video.videoWidth : DEFAULT_ASPECT;
    canvas.width = width;
    canvas.height = Math.max(1, Math.round(width * aspect));
    // Resizing the canvas clears its pixels: the next frame must be opaque.
    hasDrawnOnce = false;
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  const run = () => {
    ctx.clearInterval(timer);
    timer = video.paused || video.ended ? undefined : ctx.setInterval(draw, Math.max(1, Math.ceil(1000 / ctx.config.buffer)));
  };

  const update = () => {
    resize();
    applyStyle(ctx, canvas);
    canvas.classList.toggle("fullscreen", ctx.config.fullscreen);
    // The frame rate may have changed; and the resize emptied the canvas, so
    // redraw it at full strength instead of easing up from transparent.
    run();
    draw();
  };

  applyStyle(ctx, canvas);
  canvas.classList.toggle("fullscreen", ctx.config.fullscreen);
  resize();
  draw();
  run();
  // This glow's listeners go with it; the plugin stopping removes it too.
  const removed = new AbortController();
  video.addEventListener("play", run, { signal: removed.signal });
  video.addEventListener("pause", run, { signal: removed.signal });
  video.addEventListener("ended", run, { signal: removed.signal });
  video.addEventListener("loadedmetadata", update, { signal: removed.signal });
  wrapper.prepend(canvas);
  return {
    kind: wanted.kind,
    source: wanted.source,
    update,
    remove() {
      ctx.clearInterval(timer);
      removed.abort();
      canvas.remove();
    },
  };
}

/** How much of each new frame shows through: the share of the transition one frame covers. */
function blendAlpha(ctx: Ctx) {
  if (ctx.config.interpolationTime <= 0) return 1;
  const frameMs = 1000 / ctx.config.buffer;
  return Math.min(1, frameMs / ctx.config.interpolationTime);
}
