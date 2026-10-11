import { expect, test } from '@playwright/test';

import {
  getByPath,
  nestPartial,
  setByPath,
} from '../src/plugins/settings-ui/paths';

test('reads a dotted path through nested objects', () => {
  const config = {
    plugins: { scrobbler: { scrobblers: { lastfm: { apiKey: 'k' } } } },
  };

  expect(
    getByPath(config, 'plugins.scrobbler.scrobblers.lastfm.apiKey'),
  ).toBe('k');
  expect(getByPath(config, 'plugins.scrobbler.enabled')).toBeUndefined();
  expect(getByPath(config, 'plugins.missing.lastfm.apiKey')).toBeUndefined();
  expect(getByPath(undefined, 'options.proxy')).toBeUndefined();
});

test('a plugin field partial rebuilds the nested shape it writes to', () => {
  expect(nestPartial('scrobblers.lastfm.apiKey', 'k')).toEqual({
    scrobblers: { lastfm: { apiKey: 'k' } },
  });
});

test('patching an existing path leaves its siblings alone', () => {
  const config = { options: { tray: false, appVisible: true } };

  setByPath(config, 'options.tray', true);

  expect(config.options).toEqual({ tray: true, appVisible: true });
});

test('writing through a non-object intermediate replaces it', () => {
  const config = { options: { proxy: 'http://old' } };

  setByPath(config, 'options.proxy.host', 'example.com');

  expect(config).toEqual({ options: { proxy: { host: 'example.com' } } });
});
