import { expect, test } from '@playwright/test';

import { supportsInAppInstall } from '../src/providers/update-install-support';

test('in-app installation is supported only for compatible installations', () => {
  expect(supportsInAppInstall('win32', {})).toBe(true);

  expect(
    supportsInAppInstall('win32', {
      PORTABLE_EXECUTABLE_DIR: 'C:\\Portable',
    }),
  ).toBe(false);

  expect(
    supportsInAppInstall('win32', {
      PORTABLE_EXECUTABLE_FILE: 'Pear.exe',
    }),
  ).toBe(false);

  expect(supportsInAppInstall('darwin', {})).toBe(false);

  expect(
    supportsInAppInstall('linux', {
      APPIMAGE: '/tmp/Pear.AppImage',
    }),
  ).toBe(true);

  expect(supportsInAppInstall('linux', {})).toBe(false);
  expect(supportsInAppInstall('freebsd', {})).toBe(false);
});
