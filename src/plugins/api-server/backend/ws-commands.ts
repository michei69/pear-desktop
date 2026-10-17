import type { LikeType, RepeatMode } from '@/types/datahost-get-state';

/** What a client→server command can ask the player to do. */
export interface WsCommandActions {
  next: () => void;
  previous: () => void;
  play: () => void;
  pause: () => void;
  setSpeed: (speed: number) => void;
  seek: (position: number) => void;
  setShuffle: (enabled: boolean) => void;
  setRepeat: (mode: RepeatMode) => void;
  setVolume: (volume: number) => void;
  setMute: (muted: boolean) => void;
  rate: (rating: LikeType) => void;
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

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isRepeatMode = (value: unknown): value is RepeatMode =>
  value === 'NONE' || value === 'ALL' || value === 'ONE';

const isRating = (value: unknown): value is LikeType =>
  value === 'LIKE' || value === 'DISLIKE' || value === 'INDIFFERENT';

/** Applies every field a `PLAYBACK` command carries, in any combination. */
const runPlayback = (command: CommandMessage, actions: WsCommandActions) => {
  if (command.status === 'PLAY') actions.play();
  else if (command.status === 'PAUSE') actions.pause();

  if (isNumber(command.speed)) actions.setSpeed(command.speed);
  if (isNumber(command.position)) actions.seek(command.position);
  if (typeof command.shuffle === 'boolean') {
    actions.setShuffle(command.shuffle);
  }
  if (isRepeatMode(command.repeat)) actions.setRepeat(command.repeat);
  if (isNumber(command.volume)) actions.setVolume(command.volume);
  if (typeof command.mute === 'boolean') actions.setMute(command.mute);
};

/**
 * Runs one client→server command message. Unknown messages are ignored, and
 * nothing is ever written back: changes arrive as the broadcast events.
 */
export const runCommand = (data: unknown, actions: WsCommandActions) => {
  if (typeof data !== 'string') return;

  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return;
  }

  const command = message as CommandMessage;
  if (!command || typeof command !== 'object') return;

  switch (command.type) {
    case 'NEXT_VIDEO':
    case 'SKIP_VIDEO':
      actions.next();
      break;
    case 'PREV_VIDEO':
    case 'PREVIOUS_VIDEO':
      actions.previous();
      break;
    case 'PLAYBACK':
      runPlayback(command, actions);
      break;
    case 'RATE':
      if (isRating(command.status)) actions.rate(command.status);
      break;
    default:
      break;
  }
};
