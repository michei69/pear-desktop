import { expect, test } from '@playwright/test';
import { Window } from 'happy-dom';

import {
  createShareUrlRewriter,
  rewriteShareUrlInput,
  stripMusicSubdomain,
  stripSIParam,
} from '../src/providers/share-url';

type ShareUrlOptions = {
  stripMusicFromSharedLinks?: boolean;
  stripSIFromSharedLinks?: boolean;
};

const MUSIC_URL = 'https://music.youtube.com/watch?v=abc123';

// A happy-dom document whose window answers `mainConfig.get` from `options`, as
// the preload exposes it. Kept by reference so a test can flip an option live.
const setup = (options: ShareUrlOptions, value = MUSIC_URL) => {
  const window = new Window();
  (
    window as unknown as { mainConfig: { get(key: string): unknown } }
  ).mainConfig = {
    get: (key: string) =>
      options[key.replace('options.', '') as keyof ShareUrlOptions],
  };

  const input = window.document.createElement('input');
  input.id = 'share-url';
  input.value = value;
  window.document.body.append(input);

  return {
    document: window.document as unknown as Document,
    input,
    options,
    window,
  };
};

test('stripMusicSubdomain preserves the rest of a YouTube Music URL', () => {
  expect(
    stripMusicSubdomain(
      'https://music.youtube.com/watch?v=abc123&list=PL123#playing',
    ),
  ).toBe('https://youtube.com/watch?v=abc123&list=PL123#playing');
});

test('stripMusicSubdomain leaves unrelated and malformed URLs unchanged', () => {
  for (const url of [
    'https://youtube.com/watch?v=abc123',
    'https://www.youtube.com/watch?v=abc123',
    'https://notmusic.youtube.com/watch?v=abc123',
    'music.youtube.com/watch?v=abc123',
  ]) {
    expect(stripMusicSubdomain(url)).toBe(url);
  }
});

test('stripSIParam removes the tracking parameter and keeps the others', () => {
  expect(stripSIParam('https://youtube.com/watch?v=abc&si=xyz')).toBe(
    'https://youtube.com/watch?v=abc',
  );
  expect(stripSIParam('https://youtube.com/watch?v=abc&si=xyz&list=PL1')).toBe(
    'https://youtube.com/watch?v=abc&list=PL1',
  );
  expect(stripSIParam('https://youtube.com/watch?si=xyz&v=abc')).toBe(
    'https://youtube.com/watch?v=abc',
  );
  // A parameter that merely contains `si` is not the tracking one.
  expect(stripSIParam('https://youtube.com/watch?v=abc&music=1')).toBe(
    'https://youtube.com/watch?v=abc&music=1',
  );
  expect(stripSIParam('https://youtube.com/watch?v=abc')).toBe(
    'https://youtube.com/watch?v=abc',
  );
});

test('each option is stripped only while it is on', () => {
  const off = setup({}, MUSIC_URL);
  expect(rewriteShareUrlInput(off.document)).toBe(false);
  expect(off.input.value).toBe(MUSIC_URL);

  const musicOnly = setup({ stripMusicFromSharedLinks: true });
  expect(rewriteShareUrlInput(musicOnly.document)).toBe(true);
  expect(musicOnly.input.value).toBe('https://youtube.com/watch?v=abc123');

  const siOnly = setup(
    { stripSIFromSharedLinks: true },
    'https://music.youtube.com/watch?v=abc123&si=xyz',
  );
  expect(rewriteShareUrlInput(siOnly.document)).toBe(true);
  expect(siOnly.input.value).toBe('https://music.youtube.com/watch?v=abc123');
});

test('both options together strip the subdomain and the parameter', () => {
  const { document, input } = setup(
    { stripMusicFromSharedLinks: true, stripSIFromSharedLinks: true },
    'https://music.youtube.com/watch?v=abc123&si=xyz&list=PL1',
  );

  expect(rewriteShareUrlInput(document)).toBe(true);
  expect(input.value).toBe('https://youtube.com/watch?v=abc123&list=PL1');
  // Nothing left to strip: the field is only written once.
  expect(rewriteShareUrlInput(document)).toBe(false);
});

test('the option is re-read on every rewrite, so a toggle applies live', () => {
  const options: ShareUrlOptions = {};
  const { document, input } = setup(options);

  expect(rewriteShareUrlInput(document)).toBe(false);
  options.stripMusicFromSharedLinks = true;
  expect(rewriteShareUrlInput(document)).toBe(true);
  expect(input.value).toBe('https://youtube.com/watch?v=abc123');
});

test('a page without the share field is left alone', () => {
  const { window } = setup({ stripMusicFromSharedLinks: true });
  window.document.body.innerHTML = '';

  expect(rewriteShareUrlInput(window.document as unknown as Document)).toBe(
    false,
  );
});

test('explicit options are used instead of the window config', () => {
  // The window config says "strip music"; the explicit options are the source
  // of truth for this call.
  const { document, input } = setup({ stripMusicFromSharedLinks: true });

  expect(
    rewriteShareUrlInput(document, {
      stripMusicFromSharedLinks: false,
      stripSIFromSharedLinks: false,
    }),
  ).toBe(false);
  expect(input.value).toBe(MUSIC_URL);

  expect(
    rewriteShareUrlInput(document, {
      stripMusicFromSharedLinks: true,
      stripSIFromSharedLinks: false,
    }),
  ).toBe(true);
  expect(input.value).toBe('https://youtube.com/watch?v=abc123');
});

test('the rewriter takes its options from the getter and re-applies them on start', () => {
  const { document, input, window } = setup(
    { stripMusicFromSharedLinks: true },
    'https://music.youtube.com/watch?v=abc123&si=xyz',
  );
  const live: ShareUrlOptions = {
    stripMusicFromSharedLinks: false,
    stripSIFromSharedLinks: false,
  };
  const rewriter = createShareUrlRewriter(
    document,
    window.MutationObserver as unknown as typeof MutationObserver,
    () => live,
  );

  // The getter is the source of truth: with both options off the URL is left
  // alone even though the window config says "strip music".
  rewriter.start();
  expect(input.value).toBe('https://music.youtube.com/watch?v=abc123&si=xyz');

  // start() re-runs the rewrite, so a newly enabled option applies to the
  // current value without waiting for an interaction.
  live.stripSIFromSharedLinks = true;
  rewriter.start();
  expect(input.value).toBe('https://music.youtube.com/watch?v=abc123');

  rewriter.stop();
});

test('share URL rewriting starts and stops with the setting', () => {
  const { document, input, window } = setup({
    stripMusicFromSharedLinks: true,
  });

  const rewriter = createShareUrlRewriter(
    document,
    window.MutationObserver as unknown as typeof MutationObserver,
  );
  rewriter.start();
  expect(input.value).toBe('https://youtube.com/watch?v=abc123');

  input.value = 'https://music.youtube.com/watch?v=def456';
  window.document.body.dispatchEvent(
    new window.Event('click', { bubbles: true }),
  );
  expect(input.value).toBe('https://youtube.com/watch?v=def456');

  rewriter.stop();
  input.value = 'https://music.youtube.com/watch?v=ghi789';
  window.document.body.dispatchEvent(
    new window.Event('click', { bubbles: true }),
  );
  expect(input.value).toBe('https://music.youtube.com/watch?v=ghi789');
});
