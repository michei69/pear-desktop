import { type OpenAPIHono } from '@hono/zod-openapi';

import { subscribeIpc } from './ipc';
import { createWsAuthenticator, upgradePlayerSocket } from './websocket';
import { runCommand, type WsCommandActions } from './ws-commands';

import {
  V2RendererEvents,
  type LyricsChangedPayload,
  type TranslationUpdatedPayload,
} from '../channels';

import type { APIServerConfig } from '../config';
import type { Operations } from './operations';
import type { PlayerState } from './state';
import type { BackendContext } from '@/types/contexts';
import type { LikeType } from '@/types/datahost-get-state';

/** v2's connect payload: v1's snapshot plus speed and the current rating. */
const playerInfo = (playerState: PlayerState) => ({
  type: 'PLAYER_INFO',
  ...playerState.snapshot(),
  speed: playerState.speed ?? 1,
  rating: playerState.rating,
});

/** The commands are the same operations the HTTP routes call. */
const createCommandActions = (operations: Operations): WsCommandActions => ({
  next: operations.nextVideo,
  previous: operations.previousVideo,
  play: operations.play,
  pause: operations.pause,
  setSpeed: operations.setPlaybackSpeed,
  seek: operations.seekTo,
  setShuffle: operations.setShuffle,
  setRepeat: operations.setRepeat,
  setVolume: operations.setVolume,
  setMute: operations.setMute,
  rate: operations.setLikeState,
});

/**
 * v2's WebSocket: v1's player events, plus rating, lyrics and translation
 * pushes from the renderer, plus client→server commands. Commands are never
 * answered — every change comes back as a broadcast event.
 */
export const registerV2Websocket = (
  app: OpenAPIHono,
  { getConfig }: BackendContext<APIServerConfig>,
  playerState: PlayerState,
  operations: Operations,
  path: string,
  tags: string[] = [],
) => {
  // The last pushed lyrics/translation, so a socket that joins later catches up
  // without waiting for the next change.
  let lastLyrics: LyricsChangedPayload | null = null;
  let lastTranslation: TranslationUpdatedPayload | null = null;

  let lastRating: LikeType | undefined;
  const actions = createCommandActions(operations);

  const { broadcast, close } = upgradePlayerSocket(app, {
    path,
    tags,
    authenticate: createWsAuthenticator(getConfig),
    description:
      'WebSocket endpoint. Pushes PLAYER_INFO, VIDEO_CHANGED, ' +
      'PLAYER_STATE_CHANGED, POSITION_CHANGED, VOLUME_CHANGED, REPEAT_CHANGED, ' +
      'SHUFFLE_CHANGED, RATING_CHANGED, LYRICS_CHANGED and TRANSLATION_UPDATED. ' +
      'Commands: NEXT_VIDEO/SKIP_VIDEO, PREV_VIDEO/PREVIOUS_VIDEO, ' +
      'PLAYBACK { status, speed, position, shuffle, repeat, volume, mute } and ' +
      'RATE { status }.',
    onOpen(ws) {
      ws.send(JSON.stringify(playerInfo(playerState)));

      // Catch the new socket up on what is already known, without waiting for
      // the next change. A payload for a known different song is stale; while no
      // song is known yet, the cache can only be the one that was playing.
      const currentVideoId = playerState.song?.videoId;
      const isCurrent = (videoId: string) =>
        currentVideoId === undefined || videoId === currentVideoId;
      if (lastLyrics?.providers.length && isCurrent(lastLyrics.videoId ?? '')) {
        ws.send(JSON.stringify({ type: 'LYRICS_CHANGED', ...lastLyrics }));
      }
      if (lastTranslation && isCurrent(lastTranslation.videoId)) {
        ws.send(
          JSON.stringify({ type: 'TRANSLATION_UPDATED', ...lastTranslation }),
        );
      }
    },
    onMessage(data) {
      runCommand(data, actions);
    },
  });

  const teardown: (() => void)[] = [
    playerState.subscribe((event) => {
      broadcast(event);
      // The app clears the displayed translation with the song.
      if (event.type === 'VIDEO_CHANGED') lastTranslation = null;
    }),
    subscribeIpc<LikeType>('peard:like-changed', (rating) => {
      if (rating === lastRating) return;
      lastRating = rating;
      broadcast({ type: 'RATING_CHANGED', rating });
    }),
    subscribeIpc<LyricsChangedPayload | null>(
      V2RendererEvents.lyricsChanged,
      (lyrics) => {
        lastLyrics = lyrics;
        if (lyrics) broadcast({ type: 'LYRICS_CHANGED', ...lyrics });
      },
    ),
    subscribeIpc<TranslationUpdatedPayload>(
      V2RendererEvents.translationUpdated,
      (translation) => {
        lastTranslation = translation;
        broadcast({ type: 'TRANSLATION_UPDATED', ...translation });
      },
    ),
  ];

  return () => {
    for (const stop of teardown.splice(0)) {
      stop();
    }
    close();
  };
};
