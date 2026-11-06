export type AmbientBars = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/** No bars: the whole frame is picture. */
export const NO_BARS: AmbientBars = { top: 0, right: 0, bottom: 0, left: 0 };

export type BarDetectionOptions = {
  /** Luminance (0-255) below which a pixel counts as part of a bar. */
  threshold?: number;
  /** Fraction of lit pixels a row/column may still have to count as a bar. */
  allowedLitPixels?: number;
};

const luminance = (red: number, green: number, blue: number) =>
  0.299 * red + 0.587 * green + 0.114 * blue;

/**
 * Finds the black letterbox and pillarbox bars of a frame.
 *
 * A row or column belongs to a bar while fewer than `allowedLitPixels` of its
 * pixels are brighter than `threshold`. Scanning stops at the first row or
 * column that fails or once half the frame is consumed, so a dark scene can
 * never crop the whole picture. The result is a fraction of each side.
 */
export const detectBlackBars = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  { threshold = 24, allowedLitPixels = 0.2 }: BarDetectionOptions = {},
): AmbientBars => {
  const allowedLit = Math.max(0, Math.min(1, allowedLitPixels));

  const rowIsBar = (y: number) => {
    let lit = 0;
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const value = luminance(
        pixels[offset],
        pixels[offset + 1],
        pixels[offset + 2],
      );
      if (value > threshold) lit++;
    }
    return lit / width <= allowedLit;
  };

  const columnIsBar = (x: number) => {
    let lit = 0;
    for (let y = 0; y < height; y++) {
      const offset = (y * width + x) * 4;
      const value = luminance(
        pixels[offset],
        pixels[offset + 1],
        pixels[offset + 2],
      );
      if (value > threshold) lit++;
    }
    return lit / height <= allowedLit;
  };

  let top = 0;
  while (top < height / 2 && rowIsBar(top)) top++;

  let bottom = 0;
  while (bottom < height / 2 && rowIsBar(height - 1 - bottom)) bottom++;

  let left = 0;
  while (left < width / 2 && columnIsBar(left)) left++;

  let right = 0;
  while (right < width / 2 && columnIsBar(width - 1 - right)) right++;

  return {
    top: top / height,
    right: right / width,
    bottom: bottom / height,
    left: left / width,
  };
};
