import path from 'node:path';

// HACK: this module is code-split into dist/main/chunks, so its __dirname is
// not the app root; resolve the standalone window's files from the root instead.
export const settingsWindowPaths = (appPath: string) => ({
  preload: path.join(appPath, 'dist', 'preload', 'preload.cjs'),
  html: path.join(appPath, 'dist', 'renderer', 'settings.html'),
});
