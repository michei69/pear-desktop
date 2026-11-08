export type JobResult =
  | { ok: true; tagError?: string }
  | { ok: false; code: 'ffmpeg-not-found' | 'failed'; message: string };

// No conversion backend left: report ffmpeg-not-found so the install guidance shows.
export const wasmLoadFailure = (error: unknown): JobResult => ({
  ok: false,
  code: 'ffmpeg-not-found',
  message: error instanceof Error ? error.message : String(error),
});

// A completed download that failed to finish keeps its output: the only retry material.
export const tempFilesToRemove = (job: {
  finished: boolean;
  downloaded: boolean;
  outputPath: string;
  downloadPath: string;
  convertedPath: string;
}): string[] => {
  const tempPaths = [job.downloadPath, job.convertedPath];
  if (job.finished || !job.downloaded) return tempPaths;
  return tempPaths.filter((path) => path !== job.outputPath);
};
