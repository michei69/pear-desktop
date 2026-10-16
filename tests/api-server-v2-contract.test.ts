import { expect, test } from '@playwright/test';

import {
  ApiActions,
  apiRequest,
  type ApiAction,
} from '../src/plugins/api-server/channels';
import { registerV2 } from '../src/plugins/api-server/renderer/v2';

/**
 * The seam between the API server's backend and its renderer half: the backend
 * sends an action plus arguments, the renderer's handler performs a player
 * action. Nothing type-checks the argument *shape* across that boundary, so
 * these tests execute the real handlers and assert what they actually do —
 * which is how the `addToQueue` double-wrap (`videoIds: [['v1']]`) was found.
 */

type Recorded = {
  fetch: { url: string; data: unknown }[];
  dispatches: unknown[];
  player: string[];
  replies: { channel: string; payload: unknown }[];
};

const queueState = {
  autoplay: false,
  isInfinite: false,
  items: [] as unknown[],
  nextQueueItemId: 'next',
  playbackContentMode: 'MODE',
  repeatMode: 'NONE',
  selectedItemIndex: 0,
  shuffleEnabled: false,
  queueContextParams: 'context-params',
};

/** Registers v2 against a fake player and returns the recording helpers. */
const setup = () => {
  const recorded: Recorded = {
    fetch: [],
    dispatches: [],
    player: [],
    replies: [],
  };

  const app = {
    queue: {
      shuffle: async () => recorded.player.push('queue.shuffle'),
      continuation: 'continuation',
    },
    dispatch: (action: unknown) => recorded.dispatches.push(action),
    networkManager: {
      fetch: async (url: string, data: unknown) => {
        recorded.fetch.push({ url, data });
        return { queueDatas: [] };
      },
    },
    ytmusicReduxBehavior: {
      store: { getState: () => ({ queue: queueState }) },
    },
  };

  const likeButton = {
    likeStatus: 'LIKE',
    updateLikeStatus: (status: string) =>
      recorded.player.push(`like:${status}`),
  };

  (globalThis as unknown as { document: unknown }).document = {
    querySelector: (selector: string) => {
      if (selector === 'ytmusic-app') return app;
      if (selector === 'ytmusic-search-box') {
        return { getSearchboxStats: () => ({ stats: true }) };
      }
      if (selector === '#like-button-renderer') return likeButton;
      return null;
    },
  };

  const api = {
    getPlayerResponse: () => ({ videoDetails: { title: 'T' } }),
    nextVideo: () => recorded.player.push('nextVideo'),
    previousVideo: () => recorded.player.push('previousVideo'),
    playVideo: () => recorded.player.push('playVideo'),
    pauseVideo: () => recorded.player.push('pauseVideo'),
    getPlayerState: () => 2,
    getPlaybackRate: () => 1.25,
    setPlaybackRate: (rate: number) =>
      recorded.player.push(`setPlaybackRate:${rate}`),
    getProgressState: () => ({ current: 5, duration: 10 }),
    seekTo: (seconds: number) => recorded.player.push(`seekTo:${seconds}`),
    seekBy: (seconds: number) => recorded.player.push(`seekBy:${seconds}`),
    getVolume: () => 50,
    setVolume: (volume: number) => recorded.player.push(`setVolume:${volume}`),
    isMuted: () => false,
    mute: () => recorded.player.push('mute'),
    unMute: () => recorded.player.push('unMute'),
  };

  const listeners = new Map<string, (...args: unknown[]) => void>();
  const context = {
    ipc: {
      on: (channel: string, listener: (...args: unknown[]) => void) =>
        listeners.set(channel, listener),
      off: (channel: string) => listeners.delete(channel),
      send: (channel: string, payload: unknown) =>
        recorded.replies.push({ channel, payload }),
    },
  };

  const dispose = registerV2(api as never, context as never);

  /** Fires an action the way the backend does, then lets async work settle. */
  const fire = async (action: ApiAction, ...args: unknown[]) => {
    const handler = listeners.get(apiRequest(action));
    expect(handler, `no listener registered for ${action}`).toBeTruthy();
    handler?.(...args);
    await new Promise((resolve) => setTimeout(resolve, 10));
  };

  return { recorded, listeners, dispose, fire };
};

test('registers exactly one listener per action and unregisters them all', () => {
  const { listeners, dispose } = setup();
  const actions = Object.values(ApiActions);

  expect(listeners.size).toBe(actions.length);
  for (const action of actions) {
    expect(listeners.has(apiRequest(action)), `${action} has no listener`).toBe(
      true,
    );
  }

  dispose();
  expect(listeners.size).toBe(0);
});

test('addToQueue forwards a flat videoIds array, not a nested one', async () => {
  const { recorded, fire } = setup();

  await fire(ApiActions.addToQueue, ['v1', 'v2'], 'INSERT_AT_END');

  expect(recorded.fetch).toHaveLength(1);
  expect(recorded.fetch[0].url).toBe('/music/get_queue');
  expect(recorded.fetch[0].data).toMatchObject({
    queueInsertPosition: 'INSERT_AT_END',
    videoIds: ['v1', 'v2'],
  });
});

test('addToQueue defaults to inserting after the current video', async () => {
  const { recorded, fire } = setup();

  await fire(ApiActions.addToQueue, ['only'], 'INSERT_AFTER_CURRENT_VIDEO');

  expect(recorded.fetch[0].data).toMatchObject({
    queueInsertPosition: 'INSERT_AFTER_CURRENT_VIDEO',
    videoIds: ['only'],
  });
});

test('commands never reply, so no route can wait on one', async () => {
  const commands: ApiAction[] = [
    ApiActions.nextVideo,
    ApiActions.previousVideo,
    ApiActions.play,
    ApiActions.pause,
    ApiActions.togglePlay,
    ApiActions.setPlaybackSpeed,
    ApiActions.seekTo,
    ApiActions.seekBy,
    ApiActions.shuffle,
    ApiActions.setShuffle,
    ApiActions.setRepeat,
    ApiActions.switchRepeat,
    ApiActions.setVolume,
    ApiActions.setMute,
    ApiActions.toggleMute,
    ApiActions.setLikeState,
    ApiActions.like,
    ApiActions.dislike,
    ApiActions.unlike,
    ApiActions.moveInQueue,
    ApiActions.removeFromQueue,
    ApiActions.setQueueIndex,
    ApiActions.clearQueue,
  ];
  const args: Partial<Record<ApiAction, unknown[]>> = {
    [ApiActions.setPlaybackSpeed]: [1.5],
    [ApiActions.seekTo]: [12],
    [ApiActions.seekBy]: [-5],
    [ApiActions.setShuffle]: [true],
    [ApiActions.setRepeat]: ['ALL'],
    [ApiActions.setVolume]: [40],
    [ApiActions.setMute]: [true],
    [ApiActions.setLikeState]: ['LIKE'],
    [ApiActions.moveInQueue]: [0, 1],
    [ApiActions.removeFromQueue]: [0],
    [ApiActions.setQueueIndex]: [0],
  };

  for (const action of commands) {
    const { recorded, fire } = setup();
    await fire(action, ...(args[action] ?? []));
    expect(recorded.replies, `${action} replied`).toHaveLength(0);
  }
});

test('getPlaybackPosition reports seconds, and a 0 fraction without a duration', async () => {
  const { recorded, fire } = setup();

  await fire(ApiActions.getPlaybackPosition, false);
  expect(recorded.replies.at(-1)?.payload).toBe(5);

  await fire(ApiActions.getPlaybackPosition, true);
  expect(recorded.replies.at(-1)?.payload).toBe(0.5);
});

test('setVolume clamps to 0-100 and syncs the UI', async () => {
  const { recorded, fire } = setup();

  await fire(ApiActions.setVolume, 150);

  expect(recorded.player).toContain('setVolume:100');
  expect(recorded.dispatches).toContainEqual({
    type: 'SET_VOLUME',
    payload: 100,
  });
});
