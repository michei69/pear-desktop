export interface ThumbnailSource {
  url: string;
  width: number;
  height: number;
}

export function largestThumbnailUrl(thumbnails: readonly ThumbnailSource[] | undefined): string | undefined {
  const best = thumbnails?.toSorted((a, b) => b.width * b.height - a.width * a.height)[0];
  return best?.url.split("?")[0];
}

export async function sampleImagePixels(url: string, size = 32): Promise<Uint8ClampedArray> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, size, size);
  return context.getImageData(0, 0, size, size).data;
}
