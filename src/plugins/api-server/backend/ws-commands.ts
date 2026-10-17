import { z } from '@hono/zod-openapi';

import { LikeType, type RepeatMode } from '@/types/datahost-get-state';

import { RepeatModes } from './schemas-common';

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

const playbackStatus = z.enum(['PLAY', 'PAUSE']);
const repeatMode = z.enum(RepeatModes);
const rating = z.enum(LikeType);
const number = z.number().finite();
const boolean = z.boolean();

/** Reads one optional field, ignoring a value of the wrong type. */
const read = <T>(schema: z.ZodType<T>, value: unknown): T | undefined => {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

/** Applies every field a `PLAYBACK` command carries, in any combination. */
const runPlayback = (command: CommandMessage, actions: WsCommandActions) => {
  const status = read(playbackStatus, command.status);
  if (status === 'PLAY') actions.play();
  else if (status === 'PAUSE') actions.pause();

  const speed = read(number, command.speed);
  if (speed !== undefined) actions.setSpeed(speed);

  const position = read(number, command.position);
  if (position !== undefined) actions.seek(position);

  const shuffle = read(boolean, command.shuffle);
  if (shuffle !== undefined) actions.setShuffle(shuffle);

  const repeat = read(repeatMode, command.repeat);
  if (repeat !== undefined) actions.setRepeat(repeat);

  const volume = read(number, command.volume);
  if (volume !== undefined) actions.setVolume(volume);

  const mute = read(boolean, command.mute);
  if (mute !== undefined) actions.setMute(mute);
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

  if (!message || typeof message !== 'object') return;
  const command = message as CommandMessage;

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
    case 'RATE': {
      const value = read(rating, command.status);
      if (value !== undefined) actions.rate(value);
      break;
    }
    default:
      break;
  }
};
