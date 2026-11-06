export type AmbientLayerRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Copies of the frame between the player and the edge of the page. */
export const AMBIENT_LAYER_COUNT = 10;

/**
 * Destination rects, in canvas pixels, for the ambient light layers.
 *
 * Every layer is the source frame scaled about its own centre, so ring `n`
 * samples the frame a little further from that centre than ring `n - 1`. The
 * first rect covers the whole canvas and the last one is the frame as
 * displayed; drawing them in this order leaves the frame's border colours
 * stretched across the rest of the page, which is the effect the Ambient light
 * extension produces.
 */
export const ambientLayerRects = (
  frame: AmbientLayerRect,
  canvas: { width: number; height: number },
  layerCount = AMBIENT_LAYER_COUNT,
): AmbientLayerRect[] => {
  const centerX = frame.x + frame.width / 2;
  const centerY = frame.y + frame.height / 2;
  const halfWidth = frame.width / 2;
  const halfHeight = frame.height / 2;
  const step = layerCount > 1 ? 1 / (layerCount - 1) : 0;

  // The frame is not always centred in the viewport (the player page has a side
  // panel), so the outermost layer has to reach the farthest edge, not merely
  // be as wide as the canvas.
  const cover = Math.max(
    centerX / halfWidth,
    (canvas.width - centerX) / halfWidth,
    centerY / halfHeight,
    (canvas.height - centerY) / halfHeight,
  );

  return Array.from({ length: layerCount }, (_, index) => {
    const scale = Math.pow(cover, (layerCount - 1 - index) * step);
    const width = frame.width * scale;
    const height = frame.height * scale;

    return {
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
    };
  });
};
