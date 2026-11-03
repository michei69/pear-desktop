export const outputArgs = (
  inputPath: string,
  convertArgs: string[],
  outputPath: string,
) => ['-i', inputPath, ...convertArgs, outputPath];

export const systemFfmpegArgs = (
  inputPath: string,
  convertArgs: string[],
  outputPath: string,
) => [
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-progress',
  'pipe:1',
  '-nostats',
  ...outputArgs(inputPath, convertArgs, outputPath),
];

export const wasmFfmpegArgs = (
  inputPath: string,
  convertArgs: string[],
  outputPath: string,
) => [
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  ...outputArgs(inputPath, convertArgs, outputPath),
];

/** ffmpeg's `-progress` output reports both of these in microseconds. */
export const parseProgressSeconds = (line: string) => {
  const separator = line.indexOf('=');
  if (separator === -1) return undefined;

  const key = line.slice(0, separator);
  if (key !== 'out_time_us' && key !== 'out_time_ms') return undefined;

  const microseconds = Number(line.slice(separator + 1));
  return Number.isFinite(microseconds) ? microseconds / 1e6 : undefined;
};
