export type JobResult =
  | { ok: true; tagError?: string }
  | { ok: false; code: 'ffmpeg-not-found' | 'failed'; message: string };

/**
 * The bundled wasm core could not load. The system binary was already missing
 * (that is why the wasm path ran), so there is no usable conversion backend:
 * report `ffmpeg-not-found` so the main process shows the install guidance
 * instead of a generic conversion failure.
 */
export const wasmLoadFailure = (error: unknown): JobResult => ({
  ok: false,
  code: 'ffmpeg-not-found',
  message: error instanceof Error ? error.message : String(error),
});

/**
 * Temp files a download job should delete. A completed download that failed to
 * finish keeps exactly its `outputPath` — the only retry material left (the
 * downloaded source when conversion failed, the converted file when the rename
 * failed). Everything else, including a half-written conversion, is removed.
 */
export const tempFilesToRemove = (job: {
  /** The final rename to the destination file succeeded. */
  finished: boolean;
  /** The stream download completed. */
  downloaded: boolean;
  /** The file holding the finished output (the source before conversion). */
  outputPath: string;
  downloadPath: string;
  convertedPath: string;
}): string[] => {
  const tempPaths = [job.downloadPath, job.convertedPath];
  if (job.finished || !job.downloaded) return tempPaths;
  return tempPaths.filter((path) => path !== job.outputPath);
};
