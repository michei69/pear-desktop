import { expect, test } from '@playwright/test';

import {
  tempFilesToRemove,
  wasmLoadFailure,
} from '../src/plugins/downloader/main/ffmpeg-outcome';

const paths = {
  downloadPath: '/downloads/.pear-a.webm',
  convertedPath: '/downloads/.pear-a.mp3',
};

test('a wasm core that cannot load is reported as ffmpeg-not-found', () => {
  // The system binary was already missing (that is why the wasm path ran), so
  // a core load failure means no conversion backend exists at all.
  expect(wasmLoadFailure(new Error('cannot compile core'))).toEqual({
    ok: false,
    code: 'ffmpeg-not-found',
    message: 'cannot compile core',
  });
  expect(wasmLoadFailure('boom')).toEqual({
    ok: false,
    code: 'ffmpeg-not-found',
    message: 'boom',
  });
});

test('removes every temp file once the download was renamed into place', () => {
  expect(
    tempFilesToRemove({
      finished: true,
      downloaded: true,
      outputPath: '/downloads/song.mp3',
      ...paths,
    }),
  ).toEqual([paths.downloadPath, paths.convertedPath]);
});

test('removes every temp file when the download itself failed', () => {
  expect(
    tempFilesToRemove({
      finished: false,
      downloaded: false,
      outputPath: paths.downloadPath,
      ...paths,
    }),
  ).toEqual([paths.downloadPath, paths.convertedPath]);
});

test('a failed conversion keeps the source and drops the half-written output', () => {
  // outputPath is still downloadPath when the conversion failed.
  expect(
    tempFilesToRemove({
      finished: false,
      downloaded: true,
      outputPath: paths.downloadPath,
      ...paths,
    }),
  ).toEqual([paths.convertedPath]);
});

test('a failed rename keeps the converted file and drops the source', () => {
  expect(
    tempFilesToRemove({
      finished: false,
      downloaded: true,
      outputPath: paths.convertedPath,
      ...paths,
    }),
  ).toEqual([paths.downloadPath]);
});
