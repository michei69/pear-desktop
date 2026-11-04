export const supportsInAppInstall = (
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): boolean => {
  if (platform === 'darwin') return false;

  if (platform === 'win32') {
    return (
      !env.PORTABLE_EXECUTABLE_DIR &&
      !env.PORTABLE_EXECUTABLE_FILE
    );
  }

  if (platform === 'linux') {
    return Boolean(env.APPIMAGE);
  }

  return false;
};
