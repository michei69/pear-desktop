import { expect, test } from '@playwright/test';

import { runCommand, type WsCommandActions } from '../backend/ws-commands';

/**
 * The client→server side of the v2 WebSocket. Commands never answer: they only
 * ask the same renderer actions the HTTP routes use, so these tests record which
 * actions a message produces and in what order.
 */
const recorder = () => {
  const calls: string[] = [];
  const actions: WsCommandActions = {
    next: () => calls.push('next'),
    previous: () => calls.push('previous'),
    play: () => calls.push('play'),
    pause: () => calls.push('pause'),
    setSpeed: (speed) => calls.push(`speed:${speed}`),
    seek: (position) => calls.push(`seek:${position}`),
    setShuffle: (enabled) => calls.push(`shuffle:${enabled}`),
    setRepeat: (mode) => calls.push(`repeat:${mode}`),
    setVolume: (volume) => calls.push(`volume:${volume}`),
    setMute: (muted) => calls.push(`mute:${muted}`),
    rate: (rating) => calls.push(`rate:${rating}`),
  };

  return { calls, actions };
};

const message = (type: string, extra: object = {}) =>
  JSON.stringify({ type, ...extra });

test('NEXT_VIDEO and SKIP_VIDEO both skip', () => {
  for (const type of ['NEXT_VIDEO', 'SKIP_VIDEO']) {
    const { calls, actions } = recorder();
    runCommand(message(type), actions);
    expect(calls).toEqual(['next']);
  }
});

test('PREV_VIDEO and PREVIOUS_VIDEO both go back', () => {
  for (const type of ['PREV_VIDEO', 'PREVIOUS_VIDEO']) {
    const { calls, actions } = recorder();
    runCommand(message(type), actions);
    expect(calls).toEqual(['previous']);
  }
});

test('PLAYBACK applies every field the client sends, in order', () => {
  const { calls, actions } = recorder();

  runCommand(
    message('PLAYBACK', {
      status: 'PLAY',
      speed: 1.5,
      position: 42,
      shuffle: true,
      repeat: 'ALL',
      volume: 60,
      mute: false,
    }),
    actions,
  );

  expect(calls).toEqual([
    'play',
    'speed:1.5',
    'seek:42',
    'shuffle:true',
    'repeat:ALL',
    'volume:60',
    'mute:false',
  ]);
});

test('PLAYBACK handles a single option, and pause', () => {
  const play = recorder();
  runCommand(message('PLAYBACK', { status: 'PLAY' }), play.actions);
  expect(play.calls).toEqual(['play']);

  const pause = recorder();
  runCommand(message('PLAYBACK', { status: 'PAUSE' }), pause.actions);
  expect(pause.calls).toEqual(['pause']);

  const volume = recorder();
  runCommand(message('PLAYBACK', { volume: 20 }), volume.actions);
  expect(volume.calls).toEqual(['volume:20']);
});

test('PLAYBACK ignores values of the wrong type, applying the rest', () => {
  const { calls, actions } = recorder();

  runCommand(
    message('PLAYBACK', {
      status: 'STOP',
      speed: 'fast',
      position: 'soon',
      shuffle: 'yes',
      repeat: 'SIDEWAYS',
      volume: null,
      mute: 1,
    }),
    actions,
  );

  expect(calls).toEqual([]);
});

test('RATE applies the three states and ignores anything else', () => {
  for (const status of ['LIKE', 'DISLIKE', 'INDIFFERENT']) {
    const { calls, actions } = recorder();
    runCommand(message('RATE', { status }), actions);
    expect(calls).toEqual([`rate:${status}`]);
  }

  const invalid = recorder();
  runCommand(message('RATE', { status: 'LOVE' }), invalid.actions);
  runCommand(message('RATE'), invalid.actions);
  expect(invalid.calls).toEqual([]);
});

test('unknown commands, malformed JSON and non-text frames are ignored', () => {
  const { calls, actions } = recorder();

  runCommand(message('STOP_EVERYTHING'), actions);
  runCommand('not json', actions);
  runCommand('', actions);
  runCommand(Buffer.from('{}'), actions);
  runCommand(null, actions);
  runCommand(JSON.stringify({ type: 1 }), actions);

  expect(calls).toEqual([]);
});
