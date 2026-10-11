import { getSongControls } from '@/providers/song-controls';
import { createBackend } from '@/utils';

export const backend = createBackend({
  // `/play` parses the URL in the renderer and hands the id here, into the
  // song-controls path the tray and media keys use.
  start(ctx) {
    ctx.ipc.handle('search-commands:play', (videoId: string) =>
      getSongControls(ctx.window).loadVideo(videoId),
    );
  },

  stop(ctx) {
    ctx.ipc.removeHandler('search-commands:play');
  },
});
