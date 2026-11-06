import { expect, test } from '@playwright/test';

import { createIgnoreGate } from '../src/plugins/music-together/ignore-gate';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('holds outgoing state until the frame after the event', async () => {
  const gate = createIgnoreGate(5);

  gate.hold();
  expect(gate.active).toBe(true);

  gate.release();
  // Still held while the echo of the edit may still arrive.
  expect(gate.active).toBe(true);

  await wait(30);
  expect(gate.active).toBe(false);
});

test('a second event restarts the hold instead of releasing early', async () => {
  const gate = createIgnoreGate(20);

  gate.hold();
  gate.release();
  await wait(5);

  // A new event while the release is pending must keep the gate closed.
  gate.hold();
  await wait(30);
  expect(gate.active).toBe(true);

  gate.release();
  await wait(40);
  expect(gate.active).toBe(false);
});

test('reset drops the hold and its pending release', async () => {
  const gate = createIgnoreGate(5);

  gate.hold();
  gate.release();
  gate.reset();

  expect(gate.active).toBe(false);
  await wait(20);
  expect(gate.active).toBe(false);
});
