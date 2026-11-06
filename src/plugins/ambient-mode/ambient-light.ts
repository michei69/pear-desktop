import { AMBIENT_LAYER_COUNT, ambientLayerRects } from './ambient-layers';

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
};

/** Marks the page whose player page must be transparent for the layer to show. */
const AMBIENT_LIGHT_BODY_CLASS = 'ambient-mode-page';
const AMBIENT_LIGHT_CANVAS_CLASS = 'ambient-mode-canvas';

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
  const context = canvas.getContext('2d');
  const isVideo = source instanceof HTMLVideoElement;

  const draw = (alpha: number) => {
    if (!context) return;

    const { quality, blur, opacity } = getConfig();
    canvas.style.setProperty('--blur', `${blur}px`);
    canvas.style.setProperty('--opacity', `${opacity}`);

    const width = Math.max(1, Math.round(quality));
    const height = Math.max(
      1,
      Math.round((width * window.innerHeight) / window.innerWidth),
    );
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const rect = source.getBoundingClientRect();
    const sourceWidth = isVideo ? source.videoWidth : source.naturalWidth;
    if (rect.width === 0 || rect.height === 0 || sourceWidth === 0) return;

    // The canvas is the whole viewport at a fraction of its resolution, so
    // screen coordinates scale down by exactly this ratio.
    const scale = canvas.width / window.innerWidth;
    const layers = ambientLayerRects(
      {
        x: rect.x * scale,
        y: rect.y * scale,
        width: rect.width * scale,
        height: rect.height * scale,
      },
      canvas,
      AMBIENT_LAYER_COUNT,
    );

    // Not clearing keeps the previous frame underneath, and drawing the new
    // one at partial alpha blends the two: motion smoothing for free.
    context.globalAlpha = alpha;
    for (const layer of layers) {
      context.drawImage(source, layer.x, layer.y, layer.width, layer.height);
    }
  };

  const redraw = () => {
    context?.clearRect(0, 0, canvas.width, canvas.height);
    draw(1);
  };

  let timer: number | undefined;
  const stop = () => {
    window.clearTimeout(timer);
    timer = undefined;
  };
  const tick = () => {
    const { fps, interpolationTime } = getConfig();
    draw(
      interpolationTime > 0
        ? Math.min(1000 / interpolationTime / Math.max(1, fps), 1)
        : 1,
    );
    timer = window.setTimeout(tick, Math.max(1, Math.ceil(1000 / fps)));
  };
  const start = () => {
    if (timer === undefined) tick();
  };

  window.addEventListener('resize', redraw);

  if (isVideo) {
    source.addEventListener('play', start);
    source.addEventListener('pause', stop);
    source.addEventListener('ended', stop);

    // Draw once right away: the page background is transparent while the layer
    // is mounted, so an empty canvas would leave a hole until the first play.
    redraw();
    if (!source.paused) start();
  } else {
    if (source.complete && source.naturalWidth > 0) redraw();
    else source.addEventListener('load', redraw, { once: true });
  }

  document.body.classList.add(AMBIENT_LIGHT_BODY_CLASS);
  document.body.prepend(canvas);

  return {
    refresh: redraw,
    unregister() {
      stop();
      window.removeEventListener('resize', redraw);
      source.removeEventListener('play', start);
      source.removeEventListener('pause', stop);
      source.removeEventListener('ended', stop);
      source.removeEventListener('load', redraw);
      canvas.remove();
      document.body.classList.remove(AMBIENT_LIGHT_BODY_CLASS);
    },
  };
};
