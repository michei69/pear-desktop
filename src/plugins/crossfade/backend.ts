import { getAudioBytes, getInnertubeSession } from '@/plugins/utils/main';
import { createBackend } from '@/utils';

export const backend = createBackend({
  async start({ window, ipc }) {
    const yt = await getInnertubeSession(window);

    ipc.handle('audio-bytes', (videoID: string) =>
      getAudioBytes(yt, videoID, window),
    );
  },
});
