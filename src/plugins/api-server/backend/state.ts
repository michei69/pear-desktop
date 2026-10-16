import { ipcMain } from 'electron';

import {
  registerCallback,
  unregisterCallback,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';

import type { RepeatMode, VolumeState } from '@/types/datahost-get-state';

/**
 * The song shape the WebSocket publishes. The scrobbler's config-derived
 * title/artist are not part of it, for either version — `/api/v2/video` carries
 * those over HTTP instead.
 */
type WireSongInfo = Omit<SongInfo, 'scrobbleTitle' | 'scrobbleArtist'>;

/**
 * Messages broadcast to WebSocket clients. Each variant is sent as-is, so the
 * `type` discriminant is part of the wire protocol — don't rename the values.
 */
export type PlayerEvent =
  | { type: 'VIDEO_CHANGED'; song: WireSongInfo; position: number }
  | { type: 'PLAYER_STATE_CHANGED'; isPlaying: boolean; position: number }
  | { type: 'POSITION_CHANGED'; position: number }
  | { type: 'VOLUME_CHANGED'; volume: number; muted: boolean }
  | { type: 'REPEAT_CHANGED'; repeat: RepeatMode }
  | { type: 'SHUFFLE_CHANGED'; shuffle: boolean };

/** Full player state, sent to a client as soon as it connects. */
export interface PlayerSnapshot {
  song?: WireSongInfo;
  isPlaying: boolean;
  muted: boolean;
  position: number;
  volume: number;
  repeat: RepeatMode;
  shuffle: boolean;
}

/**
 * Single source of truth for everything the API and the WebSocket report.
 *
 * Subscribes to each renderer event exactly once; both consumers read from here
 * instead of tracking their own copies.
 */
export const createPlayerState = () => {
  let song: WireSongInfo | undefined;
  let volume: VolumeState | undefined;
  // Left undefined until the renderer reports a mode, so `/repeat-mode` can tell
  // "not known yet" apart from an actual NONE.
  let repeat: RepeatMode | undefined;
  let shuffle = false;

  const listeners = new Set<(event: PlayerEvent) => void>();
  const emit = (event: PlayerEvent) => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  // Removed individually on stop(); removeAllListeners would drop the listeners
  // other plugins registered on the same channels.
  const teardown: (() => void)[] = [];
  const subscribeIpc = <T>(channel: string, handler: (payload: T) => void) => {
    const listener = (_: unknown, payload: T) => handler(payload);
    ipcMain.on(channel, listener);
    teardown.push(() => ipcMain.removeListener(channel, listener));
  };

  const songInfoCallback = (info: SongInfo, event: SongInfoEvent) => {
    // The provider mutates and re-emits the same object, so keep our own copy.
    // `Partial` makes the scrobbler fields deletable; the WebSocket publishes
    // the `WireSongInfo` shape, which doesn't carry them.
    const current: WireSongInfo & Partial<SongInfo> = { ...info };
    delete current.scrobbleTitle;
    delete current.scrobbleArtist;
    song = current;

    switch (event) {
      case SongInfoEvent.VideoSrcChanged: {
        emit({ type: 'VIDEO_CHANGED', song: current, position: 0 });
        break;
      }
      case SongInfoEvent.PlayOrPaused: {
        emit({
          type: 'PLAYER_STATE_CHANGED',
          isPlaying: !(info.isPaused ?? true),
          position: info.elapsedSeconds ?? 0,
        });
        break;
      }
      case SongInfoEvent.TimeChanged: {
        emit({ type: 'POSITION_CHANGED', position: info.elapsedSeconds ?? 0 });
        break;
      }
      // No default
    }
  };
  registerCallback(songInfoCallback);

  subscribeIpc<VolumeState>('peard:volume-changed', (state) => {
    volume = state;
    emit({ type: 'VOLUME_CHANGED', volume: state.state, muted: state.isMuted });
  });
  subscribeIpc<RepeatMode>('peard:repeat-changed', (mode) => {
    repeat = mode;
    emit({ type: 'REPEAT_CHANGED', repeat: mode });
  });
  subscribeIpc<number>('peard:seeked', (position) => {
    emit({ type: 'POSITION_CHANGED', position });
  });
  subscribeIpc<boolean>('peard:shuffle-changed', (enabled) => {
    shuffle = enabled;
    emit({ type: 'SHUFFLE_CHANGED', shuffle: enabled });
  });

  return {
    get song() {
      return song;
    },
    get repeat() {
      return repeat;
    },
    get volume() {
      return volume;
    },
    snapshot(): PlayerSnapshot {
      return {
        song,
        isPlaying: song ? !song.isPaused : false,
        muted: volume?.isMuted ?? false,
        position: song?.elapsedSeconds ?? 0,
        // WebSocket clients have always been told 100 until the renderer
        // reports its volume.
        volume: volume?.state ?? 100,
        // ...and NONE until it reports a repeat mode.
        repeat: repeat ?? 'NONE',
        shuffle,
      };
    },
    subscribe(listener: (event: PlayerEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Tell clients playback stopped (app quitting or the server restarting). */
    notifyStopped() {
      emit({
        type: 'PLAYER_STATE_CHANGED',
        isPlaying: false,
        position: song?.elapsedSeconds ?? 0,
      });
    },
    stop() {
      unregisterCallback(songInfoCallback);
      for (const remove of teardown) {
        remove();
      }
      teardown.length = 0;
      listeners.clear();
    },
  };
};

export type PlayerState = ReturnType<typeof createPlayerState>;
