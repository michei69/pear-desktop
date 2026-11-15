// Browser permissions: deny everything YTM and the settings window don't
// need. Electron grants notifications, MIDI, HID and the rest to any page
// unless a handler says otherwise.

import type { Session } from "electron";

/** Media capture (custom output device), sanitized clipboard writes, fullscreen, DRM. */
export const ALLOWED_PERMISSIONS: Readonly<Record<string, true>> = {
  media: true,
  "clipboard-sanitized-write": true,
  fullscreen: true,
  mediaKeySystem: true,
};

export function hardenSession(session: Session) {
  session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS[permission] === true);
  });
  session.setPermissionCheckHandler((_webContents, permission) => ALLOWED_PERMISSIONS[permission] === true);
  // The page is YTM; Chromium's spellchecker only adds memory and network use.
  session.setSpellCheckerEnabled(false);
}
