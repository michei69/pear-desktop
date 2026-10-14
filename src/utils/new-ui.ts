import { liveFlags } from '../plugins/settings-ui/injectors/flags';

/** The flag YouTube Music sets when its newer (wiz miniplayer) UI is on. */
const NEW_UI_FLAG = 'music_web_enable_wiz_miniplayer';

/**
 * The same check as source, for the main process to run in the main window: the
 * standalone settings window has no page of its own to ask, so it is probed
 * there. `tests/new-ui.test.ts` holds it to `isNewUI`.
 */
export const NEW_UI_PROBE = `window.ytcfg?.data_?.EXPERIMENT_FLAGS?.['${NEW_UI_FLAG}'] === true || !!document.querySelector('ytmusic-miniplayer')`;

/**
 * Whether YouTube Music runs its newer UI: the feature flag, or the miniplayer
 * element it swaps the old `ytmusic-player-bar` for.
 */
export const isNewUI = () =>
  liveFlags()[NEW_UI_FLAG] === true ||
  !!document.querySelector('ytmusic-miniplayer');
