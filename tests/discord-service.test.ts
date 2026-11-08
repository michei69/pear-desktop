import { expect, test } from '@playwright/test';

import { TimerKey } from '../src/plugins/discord/constants';
import { DiscordService } from '../src/plugins/discord/discord-service';

import type { DiscordPluginConfig } from '../src/plugins/discord/index';

type FakeRpc = {
  isConnected: boolean;
  login: () => Promise<void>;
  destroy: () => Promise<void>;
  removeAllListeners: () => void;
};

const fakeRpc = (isConnected: boolean, onLogin: () => void): FakeRpc => ({
  isConnected,
  login: () => {
    onLogin();
    return Promise.resolve();
  },
  destroy: () => Promise.resolve(),
  removeAllListeners: () => undefined,
});

/**
 * A service whose RPC client is replaced by fakes. The constructor still builds
 * the real client, but it never connects: nothing here touches Discord.
 */
const makeService = () => {
  const service = new DiscordService({} as DiscordPluginConfig);
  const calls = { initializeRpc: 0, login: 0 };

  (service as unknown as { initializeRpc: () => void }).initializeRpc = () => {
    calls.initializeRpc += 1;
    // A rebuilt client starts disconnected, like the real one.
    service.rpc = fakeRpc(false, () => {
      calls.login += 1;
    }) as never;
  };

  return { service, calls };
};

test('a connected-but-not-ready client is not a successful reconnect', () => {
  const { service, calls } = makeService();
  service.rpc = fakeRpc(true, () => undefined) as never;
  service.ready = false;

  // A socket that is up while `ready` never fired cannot log in again: the
  // recovery path must rebuild it and keep the retry ladder armed.
  (service as unknown as { connectRecursive: () => void }).connectRecursive();

  expect(service.isConnected()).toBe(false);
  expect(calls.initializeRpc).toBe(1);
  expect(service.reconnectTimerPending).toBe(true);
  service.timerManager.clearAll();
});

test('connect() rebuilds a wedged client and logs in again', () => {
  const { service, calls } = makeService();
  service.rpc = fakeRpc(true, () => undefined) as never;
  service.ready = false;

  service.connect();

  expect(calls.initializeRpc).toBe(1);
  expect(calls.login).toBe(1);
  // The login path also gets the connected-but-never-ready timeout.
  expect(service.timerManager.timers.has(TimerKey.ReadyTimeout)).toBe(true);
  service.timerManager.clearAll();
});

test('connect() leaves an already-ready client alone', () => {
  const { service, calls } = makeService();
  service.rpc = fakeRpc(true, () => undefined) as never;
  service.ready = true;

  service.connect();

  expect(calls.initializeRpc).toBe(0);
  expect(calls.login).toBe(0);
  expect(service.timerManager.timers.size).toBe(0);
});

test('a normal connect arms the ready timeout', () => {
  const { service, calls } = makeService();
  let logins = 0;
  service.rpc = fakeRpc(false, () => {
    logins += 1;
  }) as never;
  service.ready = false;

  service.connect();

  expect(calls.initializeRpc).toBe(0);
  expect(logins).toBe(1);
  expect(service.timerManager.timers.has(TimerKey.ReadyTimeout)).toBe(true);
  service.timerManager.clearAll();
});
