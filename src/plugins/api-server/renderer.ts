import { createRenderer } from '@/utils';

import { registerV2 } from './renderer/v2';

/**
 * The api-server plugin's renderer entry.
 *
 * v1 has no renderer half — it drives everything through `song-controls` and
 * the player state — so its slot is this file. Every later version gets its own
 * module under `renderer/`: v2 lives in `./renderer/v2.ts` and registers its
 * `peard-api:` listeners against the player API here, returning the disposer we
 * keep so a re-registration (the renderer reloads on its own) or `stop` removes
 * exactly the listeners that were registered.
 */
export const renderer = createRenderer<{ teardown?: () => void }>({
  onPlayerApiReady(api, context) {
    this.teardown?.();
    this.teardown = registerV2(api, context);
  },

  stop() {
    this.teardown?.();
    this.teardown = undefined;
  },
});
