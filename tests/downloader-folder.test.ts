import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { resolveDownloadFolder } from '../src/plugins/downloader/main/folder';

const fallback = join(tmpdir(), 'downloads');

const windowsPath = 'C:\\Users\\miki\\Downloads';
const posixPath = '/home/miki/Downloads';

test('uses the configured folder when it is absolute', () => {
  const native = process.platform === 'win32' ? windowsPath : posixPath;

  expect(resolveDownloadFolder(native, fallback)).toBe(native);
});

test('falls back without a usable folder', () => {
  expect(resolveDownloadFolder(undefined, fallback)).toBe(fallback);
  expect(resolveDownloadFolder('', fallback)).toBe(fallback);
  expect(resolveDownloadFolder('Downloads', fallback)).toBe(fallback);
  expect(resolveDownloadFolder('~/Downloads', fallback)).toBe(fallback);
});

test('uses the Windows path only on Windows (issue #66)', () => {
  const resolved = resolveDownloadFolder(windowsPath, fallback);

  expect(resolved).toBe(process.platform === 'win32' ? windowsPath : fallback);
});
