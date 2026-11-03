import { createRenderer } from '@/utils';

import { registerV2 } from './renderer/v2';
import { registerV2Events } from './renderer/v2-events';

/**
 * The api-server plugin's renderer entry: every version's listener half lives
 * under `renderer/`. v2 lives in `./renderer/v2.ts` and registers its
 * `peard-api:` listeners against the player API here; v1 mostly drives the
 * player through `song-controls` and the player state, and reads its
 * `/queue/next` entry from the same renderer projection. Each registration
 * returns the disposer kept here, so a re-registration (the renderer reloads on
 * its own) or `stop` removes exactly the listeners that were registered.
 */
export const renderer = createRenderer<{ teardown?: () => void }>({
  onPlayerApiReady(api, context) {
    this.teardown?.();
    const stopV2 = registerV2(api, context);
    const stopEvents = registerV2Events(context);
    this.teardown = () => {
      stopV2();
      stopEvents();
    };
  },

  stop() {
    this.teardown?.();
    this.teardown = undefined;
  },
});
