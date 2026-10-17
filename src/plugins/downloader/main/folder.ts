import { isAbsolute } from 'node:path';

/**
 * `customFolder` when it is an absolute path for this OS, otherwise `fallback`.
 *
 * A config written on another OS can hold e.g. `C:\Users\me\Downloads`. POSIX
 * reads that as a relative name, so the download would create a literal
 * `C:\Users\me\Downloads` directory in the working directory (issue #66).
 */
export const resolveDownloadFolder = (
  customFolder: string | undefined,
  fallback: string,
) => (customFolder && isAbsolute(customFolder) ? customFolder : fallback);
