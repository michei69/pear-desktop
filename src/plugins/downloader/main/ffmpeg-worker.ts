import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname } from 'node:path';

import NodeID3 from 'node-id3';

/**
 * The downloader's ffmpeg invocation and ID3 tagging run here, in a forked
 * utility process: the ffmpeg child and the blocking ID3 writer must never hold
 * up the main process.
 *
 * A system ffmpeg is an opportunistic speed-up only — most users have none, so
 * the bundled `@ffmpeg.wasm` core is the conversion path that always works.
 */

export type TagPayload = {
  title: string;
  artist: string;
  album?: string;
  trackNumber?: string;
  coverPng?: Uint8Array;
};

export type DownloadJob = {
  /** Downloaded source file. */
  inputPath: string;
  /** Where the finished audio ends up; equals `inputPath` when nothing converts. */
  outputPath: string;
  /** ffmpeg arguments, or `null` when the download needs no conversion. */
  convert: { args: string[]; durationSeconds: number } | null;
  tags: TagPayload | null;
};

export type WorkerMessage =
  | { type: 'progress'; ratio: number }
  | { type: 'done'; ok: true; tagError?: string }
  | {
      type: 'done';
      ok: false;
      code: 'ffmpeg-not-found' | 'failed';
      message: string;
    };

const post = (message: WorkerMessage) => {
  process.parentPort.postMessage(message);
};

/** ffmpeg's `-progress` output reports both of these in microseconds. */
const parseProgressSeconds = (line: string) => {
  const separator = line.indexOf('=');
  if (separator === -1) return undefined;

  const key = line.slice(0, separator);
  if (key !== 'out_time_us' && key !== 'out_time_ms') return undefined;

  const microseconds = Number(line.slice(separator + 1));
  return Number.isFinite(microseconds) ? microseconds / 1e6 : undefined;
};

const runSystemFfmpeg = async (job: DownloadJob): Promise<WorkerMessage> => {
  const convert = job.convert!;
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-progress',
    'pipe:1',
    '-nostats',
    '-i',
    job.inputPath,
    ...convert.args,
    job.outputPath,
  ];

  return await new Promise<WorkerMessage>((resolve) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    let pendingLine = '';
    let lastPercent = -1;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      // A chunk can split a line; keep the tail for the next one.
      const lines = (pendingLine + data).split('\n');
      pendingLine = lines.pop() ?? '';

      for (const line of lines) {
        const seconds = parseProgressSeconds(line);
        if (seconds === undefined) continue;

        const ratio =
          convert.durationSeconds > 0
            ? Math.min(seconds / convert.durationSeconds, 1)
            : 0;
        const percent = Math.floor(ratio * 100);
        if (percent === lastPercent) continue;
        lastPercent = percent;
        post({ type: 'progress', ratio });
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (data: string) => {
      stderr = (stderr + data).slice(-2000);
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      resolve(
        error.code === 'ENOENT'
          ? {
              type: 'done',
              ok: false,
              code: 'ffmpeg-not-found',
              message: 'ffmpeg was not found on PATH',
            }
          : {
              type: 'done',
              ok: false,
              code: 'failed',
              message: error.message,
            },
      );
    });

    child.on('close', (code) => {
      resolve(
        code === 0
          ? { type: 'done', ok: true }
          : {
              type: 'done',
              ok: false,
              code: 'failed',
              message: stderr.trim() || `ffmpeg exited with code ${code}`,
            },
      );
    });
  });
};

/**
 * The bundled fallback: `@ffmpeg.wasm` against the core shipped in
 * node_modules, so conversion works with no ffmpeg on PATH and no network.
 * The core loads per worker process (one per job), which is fine on the path
 * that is already the slow one.
 */
const runWasmFfmpeg = async (job: DownloadJob): Promise<WorkerMessage> => {
  const convert = job.convert!;
  try {
    // Loaded on the fallback path only, so systems with a real ffmpeg never
    // pay for the wasm glue.
    const { createFFmpeg } = await import('@ffmpeg.wasm/main');
    const require = createRequire(import.meta.url);
    const ffmpeg = createFFmpeg({
      log: false,
      logger() {},
      progress() {},
      // The package default points at unpkg; use the core we ship instead.
      corePath: require.resolve('@ffmpeg.wasm/core-mt/dist/ffmpeg-core.js'),
    });

    let lastPercent = -1;
    ffmpeg.setProgress(({ ratio }: { ratio: number }) => {
      const clamped = Math.min(Math.max(ratio, 0), 1);
      const percent = Math.floor(clamped * 100);
      if (percent === lastPercent) return;
      lastPercent = percent;
      post({ type: 'progress', ratio: clamped });
    });

    await ffmpeg.load();
    // ffmpeg infers the output container from its file name, so the MEMFS
    // names carry the real extensions.
    const inputName = `input${extname(job.inputPath)}`;
    const outputName = `output${extname(job.outputPath)}`;
    ffmpeg.FS('writeFile', inputName, await readFile(job.inputPath));
    await ffmpeg.run(
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      inputName,
      ...convert.args,
      outputName,
    );
    await writeFile(job.outputPath, ffmpeg.FS('readFile', outputName));
    return { type: 'done', ok: true };
  } catch (error) {
    return {
      type: 'done',
      ok: false,
      code: 'failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

const convert = async (job: DownloadJob): Promise<WorkerMessage> => {
  const system = await runSystemFfmpeg(job);
  const missingSystem =
    system.type === 'done' && !system.ok && system.code === 'ffmpeg-not-found';
  return missingSystem ? await runWasmFfmpeg(job) : system;
};

const tag = (filePath: string, tags: TagPayload) => {
  const id3Tags: NodeID3.Tags = {
    title: tags.title,
    artist: tags.artist,
  };

  if (tags.album) id3Tags.album = tags.album;
  if (tags.trackNumber) id3Tags.trackNumber = tags.trackNumber;

  if (tags.coverPng?.length) {
    id3Tags.image = {
      mime: 'image/png',
      type: {
        id: NodeID3.TagConstants.AttachedPicture.PictureType.FRONT_COVER,
      },
      description: 'thumbnail',
      imageBuffer: Buffer.from(tags.coverPng),
    };
  }

  return NodeID3.write(id3Tags, filePath);
};

const handleJob = async (job: DownloadJob) => {
  if (job.convert) {
    const result = await convert(job);
    if (result.type === 'done' && !result.ok) {
      post(result);
      return;
    }
  }

  if (job.tags) {
    const result = tag(job.outputPath, job.tags);
    if (result !== true) {
      // The audio is already written; losing tags must not lose the file.
      post({ type: 'done', ok: true, tagError: String(result) });
      return;
    }
  }

  post({ type: 'done', ok: true });
};

process.parentPort.on('message', (event) => {
  handleJob(event.data as DownloadJob).catch((error: unknown) => {
    post({ type: 'done', ok: false, code: 'failed', message: String(error) });
  });
});
