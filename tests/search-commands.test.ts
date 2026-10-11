import { expect, test } from '@playwright/test';

import {
  isCommandLine,
  matchCommands,
  tokenize,
  type Command,
} from '../src/plugins/search-commands/commands';
import { defaultSearchCommandsConfig } from '../src/plugins/search-commands/config';
import {
  matchesKeybind,
  parseKeybind,
} from '../src/plugins/search-commands/keybind';
import { parseVideoId } from '../src/plugins/search-commands/video-id';

const command = (
  name: string,
  args?: Command['args'],
  description = `${name} description`,
): Command => ({
  name,
  args,
  description: () => description,
  run: () => {},
});

const commands: Command[] = [
  command('settings'),
  command('play', [{ name: 'url' }], 'Play a video'),
  command('playlist', [{ name: 'id' }, { name: 'index', optional: true }]),
  command('search', [{ name: 'query' }]),
];

const texts = (value: string) =>
  matchCommands(value, commands).map((r) => r.text);

test('a bare slash lists every command', () => {
  expect(texts('/')).toEqual([
    '/play <url>',
    '/playlist <id> [index]',
    '/search <query>',
    '/settings',
  ]);
});

test('a partial name filters by prefix', () => {
  expect(texts('/pl')).toEqual(['/play <url>', '/playlist <id> [index]']);
});

test('a fully typed name previews its arguments as placeholders', () => {
  const [row] = matchCommands('/play', commands);
  expect(row.text).toBe('/play <url>');
  expect(row.args).toEqual(['<url>']);
  expect(row.description).toBe('Play a video');
});

test('typed arguments replace their placeholders, left to right', () => {
  expect(texts('/play sOmEiD')).toEqual(['/play sOmEiD']);
  expect(texts('/playlist PL123')).toEqual(['/playlist PL123 [index]']);
  expect(texts('/playlist PL123 4')).toEqual(['/playlist PL123 4']);
});

test('a trailing space keeps the placeholder visible while typing', () => {
  expect(texts('/play ')).toEqual(['/play <url>']);
});

test('arguments past the declared ones are ignored', () => {
  expect(texts('/play a b c')).toEqual(['/play a']);
});

test('an unknown name with arguments matches nothing', () => {
  expect(texts('/nope x')).toEqual([]);
  expect(texts('/nope')).toEqual([]);
});

test('optional arguments render as [name]', () => {
  const [row] = matchCommands('/playlist', commands);
  expect(row.text).toBe('/playlist <id> [index]');
});

test('only a leading slash is a command line', () => {
  expect(isCommandLine('/play')).toBe(true);
  expect(isCommandLine('play')).toBe(false);
  expect(isCommandLine('')).toBe(false);
});

test('tokenize drops the slash', () => {
  expect(tokenize('/play a b')).toEqual(['play', 'a', 'b']);
  expect(tokenize('/')).toEqual(['']);
});

test('parseVideoId accepts ids, short links and watch urls', () => {
  expect(parseVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  expect(parseVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  expect(
    parseVideoId('https://music.youtube.com/watch?v=dQw4w9WgXcQ&t=30'),
  ).toBe('dQw4w9WgXcQ');
});

test('parseVideoId rejects anything without a video id', () => {
  for (const input of [
    '',
    'not a url',
    'https://music.youtube.com/',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/',
    'dQw4w9WgXc', // 10 characters
  ]) {
    expect(parseVideoId(input)).toBeUndefined();
  }
});

/** Only the fields `matchesKeybind` reads. */
const key = (init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent =>
  ({
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  }) as KeyboardEvent;

test('parseKeybind reads modifiers and the key', () => {
  expect(parseKeybind('Ctrl+/')).toEqual({
    ctrl: true,
    meta: false,
    alt: false,
    shift: false,
    key: '/',
  });

  expect(parseKeybind('Alt+Shift+Space')).toEqual({
    ctrl: false,
    meta: false,
    alt: true,
    shift: true,
    key: ' ',
  });
});

test('parseKeybind is case and spacing insensitive', () => {
  expect(parseKeybind('  ctrl + K ')).toEqual(parseKeybind('Ctrl+k'));
});

test('parseKeybind rejects what it cannot match', () => {
  for (const input of ['', '+', 'Ctrl+', 'Meta+Foo+K', 'Ctrl+Hyper+K']) {
    expect(parseKeybind(input)).toBeUndefined();
  }
});

test('matchesKeybind requires the exact modifier set', () => {
  const bind = parseKeybind('Ctrl+Shift+K');
  expect(bind).toBeDefined();

  expect(
    matchesKeybind(bind!, key({ key: 'k', ctrlKey: true, shiftKey: true })),
  ).toBe(true);
  expect(matchesKeybind(bind!, key({ key: 'k', ctrlKey: true }))).toBe(false);
  expect(
    matchesKeybind(
      bind!,
      key({ key: 'k', ctrlKey: true, shiftKey: true, altKey: true }),
    ),
  ).toBe(false);
});

test('a symbol binding ignores shift, because the symbol carries it', () => {
  const bind = parseKeybind('Ctrl+/');
  expect(bind).toBeDefined();

  // Unshifted on a US layout, shift+7 on a German one; both report `/`.
  expect(matchesKeybind(bind!, key({ key: '/', ctrlKey: true }))).toBe(true);
  expect(
    matchesKeybind(bind!, key({ key: '/', ctrlKey: true, shiftKey: true })),
  ).toBe(true);
  expect(
    matchesKeybind(bind!, key({ key: '/', ctrlKey: true, altKey: true })),
  ).toBe(false);
});

test('a letter binding keeps shift significant', () => {
  const bind = parseKeybind('Ctrl+K');
  expect(bind).toBeDefined();

  expect(matchesKeybind(bind!, key({ key: 'k', ctrlKey: true }))).toBe(true);
  expect(
    matchesKeybind(bind!, key({ key: 'K', ctrlKey: true, shiftKey: true })),
  ).toBe(false);
});

test('the default keybind is the shortcut the plugin advertises', () => {
  // Read from the plugin's own config, so changing or dropping what it
  // advertises in its settings fails here.
  const bind = parseKeybind(defaultSearchCommandsConfig.openKeybind);
  expect(bind).toBeDefined();
  expect(bind!.key).toBe('/');
  // `CmdOrCtrl` resolves to whichever modifier this platform uses.
  expect(
    matchesKeybind(
      bind!,
      key({ key: '/', ctrlKey: bind!.ctrl, metaKey: bind!.meta }),
    ),
  ).toBe(true);
  expect(matchesKeybind(bind!, key({ key: '/', altKey: true }))).toBe(false);
});
