/**
 * Shows a window on the current virtual desktop instead of switching to the one
 * it was created on: pin it to all workspaces, show, then unpin.
 */
export const showOnCurrentDesktop = (win: Electron.BrowserWindow) => {
  win.setVisibleOnAllWorkspaces(true);
  win.show();
  win.focus();
  win.setVisibleOnAllWorkspaces(false);
};
