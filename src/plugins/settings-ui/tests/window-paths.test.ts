import { expect, test } from '@playwright/test';

import { settingsWindowPaths } from '../window-paths';

test('resolves the settings window files from an unpackaged app root', () => {
  expect(settingsWindowPaths('C:\\project')).toEqual({
    preload: 'C:\\project\\dist\\preload\\preload.cjs',
    html: 'C:\\project\\dist\\renderer\\settings.html',
  });
});

test('resolves the settings window files from inside the packaged asar', () => {
  expect(
    settingsWindowPaths(
      'C:\\Users\\me\\AppData\\Local\\YouTube Music\\resources\\app.asar',
    ),
  ).toEqual({
    preload:
      'C:\\Users\\me\\AppData\\Local\\YouTube Music\\resources\\app.asar\\dist\\preload\\preload.cjs',
    html: 'C:\\Users\\me\\AppData\\Local\\YouTube Music\\resources\\app.asar\\dist\\renderer\\settings.html',
  });
});
