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

const luminance = (red: number, green: number, blue: number) => 0.299 * red + 0.587 * green + 0.114 * blue;

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

  const isBar = (start: number, length: number, stride: number) => {
    let lit = 0;
    for (let index = 0; index < length; index++) {
      const offset = (start + index * stride) * 4;
      const value = luminance(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!);
      if (value > threshold) lit++;
    }
    return lit / length <= allowedLit;
  };

  let top = 0;
  while (top < height / 2 && isBar(top * width, width, 1)) top++;

  let bottom = 0;
  while (bottom < height / 2 && isBar((height - 1 - bottom) * width, width, 1)) bottom++;

  let left = 0;
  while (left < width / 2 && isBar(left, height, width)) left++;

  let right = 0;
  while (right < width / 2 && isBar(width - 1 - right, height, width)) right++;

  return {
    top: top / height,
    right: right / width,
    bottom: bottom / height,
    left: left / width,
  };
};
