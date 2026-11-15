// Client → server WebSocket commands (v2). Nothing is ever written back:
// changes arrive as the broadcast events, whichever surface made them.

import type { WireRating, WireRepeatMode } from "./player-state.ts";

export interface WsCommandActions {
  next: () => void;
  previous: () => void;
  play: () => void;
  pause: () => void;
  setSpeed: (speed: number) => void;
  seek: (position: number) => void;
  setShuffle: (enabled: boolean) => void;
  setRepeat: (mode: WireRepeatMode) => void;
  setVolume: (volume: number) => void;
  setMute: (muted: boolean) => void;
  rate: (rating: WireRating) => void;
}

/** The loose shape a command is read as; every field is validated below. */
type CommandMessage = {
  type?: unknown;
  status?: unknown;
  speed?: unknown;
  position?: unknown;
  shuffle?: unknown;
  repeat?: unknown;
  volume?: unknown;
  mute?: unknown;
};

const REPEAT_MODES: readonly WireRepeatMode[] = ["NONE", "ALL", "ONE"];
const RATINGS: readonly WireRating[] = ["LIKE", "DISLIKE", "INDIFFERENT"];

/** Reads one optional field, ignoring a value of the wrong type. */
const read = <T>(valid: (value: unknown) => value is T, value: unknown): T | undefined => (valid(value) ? value : undefined);

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isRepeatMode = (value: unknown): value is WireRepeatMode => REPEAT_MODES.includes(value as WireRepeatMode);
const isRating = (value: unknown): value is WireRating => RATINGS.includes(value as WireRating);
const isPlaybackStatus = (value: unknown): value is "PLAY" | "PAUSE" => value === "PLAY" || value === "PAUSE";

/** Applies every field a `PLAYBACK` command carries, in any combination. */
function runPlayback(command: CommandMessage, actions: WsCommandActions) {
  const status = read(isPlaybackStatus, command.status);
  if (status === "PLAY") actions.play();
  else if (status === "PAUSE") actions.pause();

  const speed = read(isFiniteNumber, command.speed);
  if (speed !== undefined) actions.setSpeed(speed);

  const position = read(isFiniteNumber, command.position);
  if (position !== undefined) actions.seek(position);

  const shuffle = read(isBoolean, command.shuffle);
  if (shuffle !== undefined) actions.setShuffle(shuffle);

  const repeat = read(isRepeatMode, command.repeat);
  if (repeat !== undefined) actions.setRepeat(repeat);

  const volume = read(isFiniteNumber, command.volume);
  if (volume !== undefined) actions.setVolume(volume);

  const mute = read(isBoolean, command.mute);
  if (mute !== undefined) actions.setMute(mute);
}

/** Runs one command message; unknown messages are ignored. */
export function runCommand(data: unknown, actions: WsCommandActions) {
  if (typeof data !== "string") return;

  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return;
  }
  if (!message || typeof message !== "object") return;
  const command = message as CommandMessage;

  switch (command.type) {
    case "NEXT_VIDEO":
    case "SKIP_VIDEO":
      actions.next();
      break;
    case "PREV_VIDEO":
    case "PREVIOUS_VIDEO":
      actions.previous();
      break;
    case "PLAYBACK":
      runPlayback(command, actions);
      break;
    case "RATE": {
      const value = read(isRating, command.status);
      if (value !== undefined) actions.rate(value);
      break;
    }
    default:
      break;
  }
}
