// The single source of truth for what both WebSocket versions report, and for
// the HTTP getters that read cached state (playing, volume, repeat, rating).
//
// Every change is turned into one event, deduplicated over a short window (the
// page can report the same change twice, e.g. a fallback racing the real
// update), then fanned out to the per-version socket registries.

import { livePosition, type LikeStatus, type NowPlaying } from "@pear/sdk";
import type { SongDetails } from "@pear/sdk/song-details";
import { isPaused, REPEAT_NAMES, songInfo } from "./song-info.ts";
import type { SongInfo } from "./types.ts";

/** The song shape the WebSocket publishes (the v1 SongInfo, without scrobbler extras). */
export type WireSongInfo = SongInfo;

export type WireRepeatMode = "NONE" | "ALL" | "ONE";
export type WireRating = "LIKE" | "DISLIKE" | "INDIFFERENT";

/** Messages broadcast to WebSocket clients; `type` is part of the wire protocol. */
export type PlayerEvent =
  | { type: "VIDEO_CHANGED"; song: WireSongInfo; position: number }
  | { type: "PLAYER_STATE_CHANGED"; isPlaying: boolean; position: number }
  | { type: "POSITION_CHANGED"; position: number }
  | { type: "VOLUME_CHANGED"; volume: number; muted: boolean }
  | { type: "REPEAT_CHANGED"; repeat: WireRepeatMode }
  | { type: "SHUFFLE_CHANGED"; shuffle: boolean }
  | { type: "RATING_CHANGED"; rating: WireRating };

/** Full player state, sent to a client as soon as it connects. */
export interface PlayerSnapshot {
  song?: WireSongInfo;
  isPlaying: boolean;
  muted: boolean;
  position: number;
  volume: number;
  repeat: WireRepeatMode;
  shuffle: boolean;
}

const RATINGS: Record<LikeStatus, WireRating> = { like: "LIKE", dislike: "DISLIKE", none: "INDIFFERENT" };

/** A renderer reporting the same change twice is noise: drop repeats within this window. */
const DUPLICATE_EVENT_WINDOW_MS = 1_000;

export class PlayerState {
  #song: WireSongInfo | undefined;
  #details: SongDetails | undefined;
  #speed: number | undefined;
  #lastPosition = -1;
  #lastMessage: string | undefined;
  #lastMessageAt = 0;
  readonly #state: () => NowPlaying;
  readonly #listeners = new Set<(event: PlayerEvent) => void>();

  constructor(state: () => NowPlaying) {
    this.#state = state;
  }

  get song() {
    return this.#song;
  }

  get playing() {
    return !!this.#state().track && !isPaused(this.#state());
  }

  get repeat(): WireRepeatMode | undefined {
    const { track, repeat } = this.#state();
    return track ? REPEAT_NAMES[repeat] : undefined;
  }

  get shuffle() {
    return this.#state().shuffle;
  }

  get muted() {
    return this.#state().muted;
  }

  get volumeLevel() {
    return this.#state().volume;
  }

  /** Playback rate, as last set through the API (1 until then). */
  get speed() {
    return this.#speed;
  }

  /** The current song's like state. */
  get rating(): WireRating {
    return RATINGS[this.#state().like];
  }

  setSpeed(speed: number) {
    this.#speed = speed;
  }

  setDetails(details: SongDetails | undefined) {
    this.#details = details;
    this.#song = songInfo(this.#state(), details) ?? undefined;
  }

  snapshot(): PlayerSnapshot {
    const state = this.#state();
    const repeat = this.repeat ?? "NONE";
    return {
      ...(this.#song ? { song: this.#song } : {}),
      isPlaying: this.playing,
      muted: state.muted,
      position: Math.floor(livePosition(state)),
      volume: state.volume,
      repeat,
      shuffle: state.shuffle,
    };
  }

  /** v1 and v2 send the same events; v2 adds RATING_CHANGED on top. */
  subscribe(listener: (event: PlayerEvent) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Reads the mirror's change (the previous state is only useful for comparisons). */
  update(state: NowPlaying, previous: NowPlaying) {
    this.#song = songInfo(state, this.#details) ?? undefined;
    const position = Math.floor(livePosition(state));

    if (state.volume !== previous.volume || state.muted !== previous.muted) {
      this.#emit({ type: "VOLUME_CHANGED", volume: state.volume, muted: state.muted });
    }
    if (state.repeat !== previous.repeat) this.#emit({ type: "REPEAT_CHANGED", repeat: REPEAT_NAMES[state.repeat] });
    if (state.shuffle !== previous.shuffle) this.#emit({ type: "SHUFFLE_CHANGED", shuffle: state.shuffle });
    if (state.like !== previous.like) this.#emit({ type: "RATING_CHANGED", rating: RATINGS[state.like] });
    if (isPaused(state) !== isPaused(previous)) {
      this.#emit({ type: "PLAYER_STATE_CHANGED", isPlaying: !isPaused(state), position });
    }
    if (!state.ad && position !== this.#lastPosition) {
      this.#lastPosition = position;
      if (state.track) this.#emit({ type: "POSITION_CHANGED", position });
    }
  }

  /** A track's details arrived: republish the song clients already heard about. */
  emitVideoChanged(song?: WireSongInfo, position = 0) {
    const current = song ?? this.#song;
    if (!current) return;
    this.#lastPosition = 0;
    this.#emit({ type: "VIDEO_CHANGED", song: current, position });
  }

  /** Tell clients playback stopped (app quitting or the server restarting). */
  notifyStopped() {
    this.#emit({ type: "PLAYER_STATE_CHANGED", isPlaying: false, position: Math.floor(livePosition(this.#state())) });
  }

  #emit(event: PlayerEvent) {
    const message = JSON.stringify(event);
    const now = Date.now();
    if (message === this.#lastMessage && now - this.#lastMessageAt < DUPLICATE_EVENT_WINDOW_MS) return;
    this.#lastMessage = message;
    this.#lastMessageAt = now;
    for (const listener of this.#listeners) listener(event);
  }
}

/** v2's connect payload: v1's snapshot plus speed and the current rating. */
export function playerInfoV2(state: PlayerState) {
  return {
    type: "PLAYER_INFO",
    ...state.snapshot(),
    speed: state.speed ?? 1,
    rating: state.rating,
  };
}

/** v1's connect payload, unchanged from the original server. */
export function playerInfoV1(state: PlayerState) {
  return { type: "PLAYER_INFO", ...state.snapshot() };
}
