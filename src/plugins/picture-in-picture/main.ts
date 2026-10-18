import { app } from 'electron';

import { debounce } from '@/providers/decorators';

import type { PictureInPicturePluginConfig } from './index';
import type { BackendContext } from '@/types/contexts';

/** Trailing debounce for the PiP window geometry written during a drag. */
const PIP_GEOMETRY_SAVE_MS = 500;

let config: PictureInPicturePluginConfig;

export const onMainLoad = async ({
  window,
  getConfig,
  setConfig,
  ipc: { send, on },
}: BackendContext<PictureInPicturePluginConfig>) => {
  let isInPiP = false;
  let originalPosition: number[];
  let originalSize: number[];
  let originalFullScreen: boolean;
  let originalMaximized: boolean;

  const pipPosition = () =>
    (config.savePosition && config['pip-position']) || [10, 10];
  const pipSize = () => (config.saveSize && config['pip-size']) || [450, 275];

  const togglePiP = () => {
    isInPiP = !isInPiP;
    setConfig({ isInPiP });

    if (isInPiP) {
      originalFullScreen = window.isFullScreen();
      if (originalFullScreen) {
        window.setFullScreen(false);
      }

      originalMaximized = window.isMaximized();
      if (originalMaximized) {
        window.unmaximize();
      }

      originalPosition = window.getPosition();
      originalSize = window.getSize();

      window.webContents.addListener('before-input-event', blockShortcutsInPiP);

      window.setMaximizable(false);
      window.setFullScreenable(false);

      send('peard:pip-toggle', true);

      app.dock?.hide();
      window.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
      });
      app.dock?.show();
      if (config.alwaysOnTop) {
        window.setAlwaysOnTop(true, 'screen-saver', 1);
      }
    } else {
      window.webContents.removeListener(
        'before-input-event',
        blockShortcutsInPiP,
      );
      window.setMaximizable(true);
      window.setFullScreenable(true);

      send('peard:pip-toggle', false);

      window.setVisibleOnAllWorkspaces(false);
      window.setAlwaysOnTop(false);

      if (originalFullScreen) {
        window.setFullScreen(true);
      }

      if (originalMaximized) {
        window.maximize();
      }
    }

    const [x, y] = isInPiP ? pipPosition() : originalPosition;
    const [w, h] = isInPiP ? pipSize() : originalSize;
    window.setPosition(x, y);
    window.setSize(w, h);

    window.setWindowButtonVisibility?.(!isInPiP);
  };

  const blockShortcutsInPiP = (
    event: Electron.Event,
    input: Electron.Input,
  ) => {
    const key = input.key.toLowerCase();

    if (key === 'f') {
      event.preventDefault();
    } else if (key === 'escape') {
      togglePiP();
      event.preventDefault();
    }
  };

  config ??= await getConfig();
  setConfig({ isInPiP });
  on('plugin:toggle-picture-in-picture', () => {
    togglePiP();
  });

  // A drag fires these tens of times per second and every write rewrites the
  // whole config file, so only the last geometry of a gesture is persisted.
  // The values are captured per event: by the time the timer fires the window
  // may already be back at its restored place.
  const savePosition = debounce(
    (position: [number, number]) => setConfig({ 'pip-position': position }),
    PIP_GEOMETRY_SAVE_MS,
  );
  const saveSize = debounce(
    (size: [number, number]) => setConfig({ 'pip-size': size }),
    PIP_GEOMETRY_SAVE_MS,
  );

  window.on('move', () => {
    if (!isInPiP || config.useNativePiP) return;

    const [x, y] = window.getPosition();
    savePosition([x, y]);
  });

  window.on('resize', () => {
    if (!isInPiP || config.useNativePiP) return;

    const [width, height] = window.getSize();
    saveSize([width, height]);
  });
};

export const onConfigChange = (newConfig: PictureInPicturePluginConfig) => {
  config = newConfig;
};
