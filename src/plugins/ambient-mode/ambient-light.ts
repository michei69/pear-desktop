import { AMBIENT_LAYER_COUNT, ambientLayerRects } from './ambient-layers';
import { type AmbientBars, detectBlackBars, NO_BARS } from './black-bars';

import type { AmbientModeSync, AmbientModeTheme } from './types';

export type AmbientLightSource = HTMLVideoElement | HTMLImageElement;

export type AmbientLightConfig = {
  /** Canvas width in pixels; the height follows the viewport aspect. */
  quality: number;
  /** Frames per second. */
  fps: number;
  /** Milliseconds a frame takes to fade into the next; 0 draws instantly. */
  interpolationTime: number;
  /** CSS blur radius in pixels. */
  blur: number;
  /** Opacity of the layer. */
  opacity: number;
  /** Ignore black letterbox and pillarbox bars when projecting. */
  barDetection: boolean;
  /** CSS filter percentages; 100 leaves the layer untouched. */
  brightness: number;
  contrast: number;
  saturation: number;
  /** Tone mixed over the layer, underneath the page content. */
  theme: AmbientModeTheme;
  /** Opacity of that tone, in percent. */
  dimming: number;
  /** Percentage of the way to the page edge where the wash starts fading. */
  fadeStart: number;
  /** Shape of that fade, 1-100. */
  fadeCurve: number;
  /** Seconds the layer takes to fade in when it appears. */
  fadeIn: number;
  /** What schedules the redraws. */
  sync: AmbientModeSync;
  /** Skip redraws while the video frame does not change. */
  energySaver: boolean;
};

type Rect = { x: number; y: number; width: number; height: number };

/** Marks the page whose player page must be transparent for the layer to show. */
const AMBIENT_LIGHT_BODY_CLASS = 'ambient-mode-page';
const AMBIENT_LIGHT_CANVAS_CLASS = 'ambient-mode-canvas';
const AMBIENT_LIGHT_FADE_CLASS = 'ambient-mode-canvas--fade';
const AMBIENT_LIGHT_SCRIM_CLASS = 'ambient-mode-scrim';

/** Bars change slowly; sampling the frame four times a second is plenty. */
const BAR_DETECTION_INTERVAL = 200;
/** Weight of a new detection against the running average. */
const BAR_DETECTION_SMOOTHING = 0.35;
const BAR_DETECTION_WIDTH = 96;

/** How often the energy saver compares two frames. */
const SIGNATURE_INTERVAL = 250;
const SIGNATURE_WIDTH = 16;
const SIGNATURE_HEIGHT = 9;
/** Mean per-channel difference (0-255) below which a frame is "unchanged". */
const SIGNATURE_THRESHOLD = 1;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** The app's own page background, used as the fill colour of the `auto` theme. */
const pageFillColor = () => {
  const color = getComputedStyle(
    document.querySelector('#player-page') ?? document.body,
  ).backgroundColor;

  return color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent'
    ? color
    : '#030303';
};

type PictureArea = {
  /** On-screen picture rect, in canvas pixels. */
  rect: Rect;
  /** The same area inside the source, in source pixels. */
  crop: Rect;
};

/** The picture area of a frame, i.e. the part between the detected bars. */
const pictureArea = (
  frame: Rect,
  bars: AmbientBars,
  sourceWidth: number,
  sourceHeight: number,
): PictureArea | null => {
  const left = frame.width * bars.left;
  const right = frame.width * bars.right;
  const top = frame.height * bars.top;
  const bottom = frame.height * bars.bottom;

  const width = frame.width - left - right;
  const height = frame.height - top - bottom;

  // Never let a noisy detection collapse the projection area.
  if (width < frame.width * 0.1 || height < frame.height * 0.1) return null;

  return {
    rect: { x: frame.x + left, y: frame.y + top, width, height },
    crop: {
      x: sourceWidth * bars.left,
      y: sourceHeight * bars.top,
      width: sourceWidth * (1 - bars.left - bars.right),
      height: sourceHeight * (1 - bars.top - bars.bottom),
    },
  };
};

/**
 * Mounts a full-page canvas behind the app and keeps it filled with the
 * stretched border of `source`, the way the Ambient light extension does it.
 *
 * The canvas is prepended to `document.body` at `z-index: 0`, so the player
 * page has to drop its own background for the layer to be visible; the plugin
 * stylesheet does that through {@link AMBIENT_LIGHT_BODY_CLASS}. Returns
 * `refresh` for config changes and `unregister` for the plugin teardown.
 */
export const mountAmbientLight = (
  source: AmbientLightSource,
  getConfig: () => AmbientLightConfig,
): { refresh: () => void; unregister: () => void } => {
  const canvas = document.createElement('canvas');
  canvas.classList.add(AMBIENT_LIGHT_CANVAS_CLASS);
  const scrim = document.createElement('div');
  scrim.classList.add(AMBIENT_LIGHT_SCRIM_CLASS);
  const context = canvas.getContext('2d');
  const isVideo = source instanceof HTMLVideoElement;
  const fillColor = pageFillColor();

  const bars: AmbientBars = { ...NO_BARS };
  let detectCanvas: HTMLCanvasElement | null = null;
  let detectionBlocked = false;
  let hasDetection = false;
  let lastDetection = 0;

  const readBars = () => {
    if (detectionBlocked) return;

    const now = performance.now();
    if (now - lastDetection < BAR_DETECTION_INTERVAL) return;
    lastDetection = now;

    const video = source as HTMLVideoElement;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    detectCanvas ??= document.createElement('canvas');
    const height = Math.max(
      8,
      Math.round((BAR_DETECTION_WIDTH * video.videoHeight) / video.videoWidth),
    );
    if (
      detectCanvas.width !== BAR_DETECTION_WIDTH ||
      detectCanvas.height !== height
    ) {
      detectCanvas.width = BAR_DETECTION_WIDTH;
      detectCanvas.height = height;
    }

    const detectContext = detectCanvas.getContext('2d', {
      willReadFrequently: true,
    });
    if (!detectContext) return;

    detectContext.drawImage(video, 0, 0, BAR_DETECTION_WIDTH, height);
    let detected: AmbientBars;
    try {
      detected = detectBlackBars(
        detectContext.getImageData(0, 0, BAR_DETECTION_WIDTH, height).data,
        BAR_DETECTION_WIDTH,
        height,
      );
    } catch {
      // A cross-origin video taints the canvas; stop trying to read it back.
      detectionBlocked = true;
      return;
    }

    // A row on the bar/picture border is a blend of both, so it never counts
    // as a bar. Pad every detected side by one sample to keep that sliver out
    // of the projection.
    const padY = 1 / height;
    const padX = 1 / BAR_DETECTION_WIDTH;
    if (detected.top > 0) detected.top = Math.min(0.5, detected.top + padY);
    if (detected.bottom > 0)
      detected.bottom = Math.min(0.5, detected.bottom + padY);
    if (detected.left > 0) detected.left = Math.min(0.5, detected.left + padX);
    if (detected.right > 0)
      detected.right = Math.min(0.5, detected.right + padX);

    // The first sample is applied as-is: averaging up from zero would leave a
    // sliver of the bar in the projection for the first second.
    if (!hasDetection) {
      Object.assign(bars, detected);
      hasDetection = true;
      return;
    }

    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      bars[side] += (detected[side] - bars[side]) * BAR_DETECTION_SMOOTHING;
    }
  };

  let signatureCanvas: HTMLCanvasElement | null = null;
  let signatureBlocked = false;
  let signature: Uint8ClampedArray | null = null;
  let signatureTime = 0;
  let frameChanged = true;

  /** Whether the current video frame differs from the previously drawn one. */
  const frameChangedNow = () => {
    if (signatureBlocked) return true;

    const now = performance.now();
    if (signature && now - signatureTime < SIGNATURE_INTERVAL) {
      return frameChanged;
    }
    signatureTime = now;

    const video = source as HTMLVideoElement;
    if (video.videoWidth === 0 || video.videoHeight === 0) return frameChanged;

    signatureCanvas ??= document.createElement('canvas');
    signatureCanvas.width = SIGNATURE_WIDTH;
    signatureCanvas.height = SIGNATURE_HEIGHT;
    const signatureContext = signatureCanvas.getContext('2d', {
      willReadFrequently: true,
    });
    if (!signatureContext) return true;

    signatureContext.drawImage(video, 0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT);

    let data: Uint8ClampedArray;
    try {
      data = signatureContext.getImageData(
        0,
        0,
        SIGNATURE_WIDTH,
        SIGNATURE_HEIGHT,
      ).data;
    } catch {
      // Cross-origin video: the canvas cannot be read, so never skip a frame.
      signatureBlocked = true;
      return true;
    }

    if (!signature) {
      signature = data;
      frameChanged = true;
      return true;
    }

    let difference = 0;
    for (let index = 0; index < data.length; index++) {
      difference += Math.abs(data[index] - signature[index]);
    }
    signature = data;
    frameChanged = difference / data.length > SIGNATURE_THRESHOLD;
    return frameChanged;
  };

  const draw = (alpha: number, force = false) => {
    if (!context) return;

    const config = getConfig();
    canvas.style.setProperty('--blur', `${config.blur}px`);
    canvas.style.setProperty('--opacity', `${config.opacity}`);
    canvas.style.setProperty('--brightness', `${config.brightness}%`);
    canvas.style.setProperty('--contrast', `${config.contrast}%`);
    canvas.style.setProperty('--saturation', `${config.saturation}%`);
    canvas.style.setProperty('--fade-in', `${Math.max(0, config.fadeIn)}s`);
    scrim.style.setProperty(
      '--fill-color',
      config.theme === 'light'
        ? '#fff'
        : config.theme === 'dark'
          ? '#000'
          : fillColor,
    );
    scrim.style.setProperty(
      '--dimming',
      `${clamp(config.dimming, 0, 100) / 100}`,
    );
    scrim.style.setProperty('--fade-in', `${Math.max(0, config.fadeIn)}s`);

    // The wash fades toward the page edges so text there keeps its contrast.
    const fading = config.fadeStart < 100;
    canvas.classList.toggle(AMBIENT_LIGHT_FADE_CLASS, fading);
    if (fading) {
      const start = clamp(config.fadeStart, 0, 99.9);
      const curve = clamp(config.fadeCurve, 1, 100);
      canvas.style.setProperty('--fade-start', `${start}%`);
      canvas.style.setProperty(
        '--fade-hint',
        `${start + ((100 - start) * curve) / 100}%`,
      );
    }

    const width = Math.max(1, Math.round(config.quality));
    const height = Math.max(
      1,
      Math.round((width * window.innerHeight) / window.innerWidth),
    );
    const resized = canvas.width !== width || canvas.height !== height;
    if (resized) {
      canvas.width = width;
      canvas.height = height;
    }

    const rect = source.getBoundingClientRect();
    const sourceWidth = isVideo ? source.videoWidth : source.naturalWidth;
    const sourceHeight = isVideo ? source.videoHeight : source.naturalHeight;
    if (rect.width === 0 || rect.height === 0 || sourceWidth === 0) return;

    if (
      isVideo &&
      config.energySaver &&
      !force &&
      !resized &&
      !frameChangedNow()
    )
      return;

    // The canvas is the whole viewport at a fraction of its resolution, so
    // screen coordinates scale down by exactly this ratio.
    const scale = canvas.width / window.innerWidth;
    const frame = {
      x: rect.x * scale,
      y: rect.y * scale,
      width: rect.width * scale,
      height: rect.height * scale,
    };

    let picture: PictureArea | null = null;
    if (isVideo && config.barDetection) {
      readBars();
      picture = pictureArea(frame, bars, sourceWidth, sourceHeight);
    }

    // The fade mask is a radial gradient around the picture, not the page.
    const focus = picture?.rect ?? frame;
    canvas.style.setProperty(
      '--ambient-center',
      `${((focus.x + focus.width / 2) / canvas.width) * 100}% ${
        ((focus.y + focus.height / 2) / canvas.height) * 100
      }%`,
    );

    const layers = ambientLayerRects(focus, canvas, AMBIENT_LAYER_COUNT);

    // Not clearing keeps the previous frame underneath, and drawing the new
    // one at partial alpha blends the two: motion smoothing for free.
    context.globalAlpha = alpha;
    for (const layer of layers) {
      if (picture) {
        // Draw only the picture: the bars must not be stretched with it.
        context.drawImage(
          source,
          picture.crop.x,
          picture.crop.y,
          picture.crop.width,
          picture.crop.height,
          layer.x,
          layer.y,
          layer.width,
          layer.height,
        );
      } else {
        context.drawImage(source, layer.x, layer.y, layer.width, layer.height);
      }
    }
  };

  const redraw = (force = false) => {
    context?.clearRect(0, 0, canvas.width, canvas.height);
    draw(1, force);
  };

  let running = false;
  let timer: number | undefined;
  let rafId: number | undefined;
  let videoFrameId: number | undefined;
  let lastDraw = 0;

  const cancelScheduled = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
    if (rafId !== undefined) {
      window.cancelAnimationFrame(rafId);
      rafId = undefined;
    }
    if (videoFrameId !== undefined) {
      (source as HTMLVideoElement).cancelVideoFrameCallback(videoFrameId);
      videoFrameId = undefined;
    }
  };

  const drawNow = () => {
    const { fps, interpolationTime } = getConfig();
    lastDraw = performance.now();
    draw(
      interpolationTime > 0
        ? Math.min(1000 / interpolationTime / Math.max(1, fps), 1)
        : 1,
    );
  };

  /** Decoded: one fixed timer, the cheapest option and the old behaviour. */
  const timerLoop = () => {
    if (!running) return;
    drawNow();
    const { fps } = getConfig();
    timer = window.setTimeout(timerLoop, Math.max(1, Math.ceil(1000 / fps)));
  };

  /** Display: draw at most once per `fps` while the screen refreshes. */
  const rafLoop = () => {
    if (!running) return;
    const { fps } = getConfig();
    if (performance.now() - lastDraw >= 1000 / Math.max(1, fps)) drawNow();
    rafId = window.requestAnimationFrame(rafLoop);
  };

  /** Video: draw once per presented video frame, capped by `fps`. */
  const videoLoop = () => {
    if (!running) return;
    const video = source as HTMLVideoElement;
    videoFrameId = video.requestVideoFrameCallback(() => {
      videoFrameId = undefined;
      if (!running) return;
      const { fps } = getConfig();
      if (performance.now() - lastDraw >= 1000 / Math.max(1, fps)) drawNow();
      videoLoop();
    });
  };

  const stop = () => {
    running = false;
    cancelScheduled();
  };

  const start = () => {
    if (running) return;
    running = true;

    const video = source as HTMLVideoElement;
    const { sync } = getConfig();
    if (sync === 'display') {
      rafId = window.requestAnimationFrame(rafLoop);
    } else if (
      sync === 'video' &&
      isVideo &&
      typeof video.requestVideoFrameCallback === 'function'
    ) {
      videoLoop();
    } else {
      timerLoop();
    }
  };

  const refresh = () => {
    const playing = isVideo && !source.paused;
    stop();
    redraw(true);
    if (playing) start();
  };

  const onResize = () => redraw(true);
  const onImageLoad = () => redraw(true);

  window.addEventListener('resize', onResize);

  if (isVideo) {
    source.addEventListener('play', start);
    source.addEventListener('pause', stop);
    source.addEventListener('ended', stop);
  } else if (!(source.complete && source.naturalWidth > 0)) {
    source.addEventListener('load', onImageLoad, { once: true });
  }

  // The fade-in animation starts on insertion, so the duration has to be set
  // before the element is in the document.
  const fadeIn = `${Math.max(0, getConfig().fadeIn)}s`;
  canvas.style.setProperty('--fade-in', fadeIn);
  scrim.style.setProperty('--fade-in', fadeIn);

  document.body.classList.add(AMBIENT_LIGHT_BODY_CLASS);
  document.body.prepend(canvas);
  canvas.insertAdjacentElement('afterend', scrim);

  // Draw once right away: the page background is transparent while the layer
  // is mounted, so an empty canvas would leave a hole. Appending the canvas
  // before this draw also starts the fade-in animation.
  redraw(true);
  if (isVideo && !source.paused) start();

  return {
    refresh,
    unregister() {
      stop();
      window.removeEventListener('resize', onResize);
      source.removeEventListener('play', start);
      source.removeEventListener('pause', stop);
      source.removeEventListener('ended', stop);
      source.removeEventListener('load', onImageLoad);
      canvas.remove();
      scrim.remove();
      document.body.classList.remove(AMBIENT_LIGHT_BODY_CLASS);
    },
  };
};
