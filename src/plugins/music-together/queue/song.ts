import type { MusicPlayerAppElement } from '@/types/music-player-app-element';
import type { QueueElement } from '@/types/queue';

export type QueueRendererResponse = {
  queueDatas: {
    content?: unknown;
  }[];
  responseContext: unknown;
  trackingParams: string;
};

export const getMusicQueueRenderer = async (
  videoIds: string[],
): Promise<QueueRendererResponse | null> => {
  if (!videoIds.length) return null;

  const queue = document.querySelector<QueueElement>('#queue');
  const app = document.querySelector<MusicPlayerAppElement>('ytmusic-app');
  if (!app) return null;

  const store = queue?.queue.store.store;
  if (!store) return null;

  try {
    const response = await app.networkManager.fetch<
      QueueRendererResponse,
      {
        queueContextParams: string;
        videoIds: string[];
      }
    >('/music/get_queue', {
      queueContextParams: store.getState().queue.queueContextParams,
      videoIds,
    });

    // A malformed response must never feed undefined rows into the queue.
    return Array.isArray(response?.queueDatas) ? response : null;
  } catch (error) {
    console.warn('Music Together: /music/get_queue failed', error);
    return null;
  }
};
