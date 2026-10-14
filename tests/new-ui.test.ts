import { expect, test } from '@playwright/test';
import { Window } from 'happy-dom';

import { isNewUI, NEW_UI_PROBE } from '../src/utils/new-ui';

/** A page with the given experiment flags, and the miniplayer element or not. */
const page = (flags: Record<string, unknown>, miniplayer: boolean) => {
  const window = new Window();
  if (miniplayer) {
    window.document.body.append(
      window.document.createElement('ytmusic-miniplayer'),
    );
  }
  (window as unknown as { ytcfg: unknown }).ytcfg = {
    data_: { EXPERIMENT_FLAGS: flags },
  };

  globalThis.window = window as unknown as typeof globalThis.window;
  globalThis.document = window.document as unknown as Document;
};

/** The probe as the backend runs it: evaluated in the page, against the globals. */
const probe = () => new Function(`return ${NEW_UI_PROBE}`)() as boolean;

/** Both answers, which must agree: the renderer's and the main process's. */
const answers = () => [isNewUI(), probe()];

test('the flag alone is the new UI', () => {
  page({ music_web_enable_wiz_miniplayer: true }, false);
  expect(answers()).toEqual([true, true]);
});

test('the miniplayer element alone is the new UI', () => {
  page({}, true);
  expect(answers()).toEqual([true, true]);
});

test('neither means the old UI', () => {
  page({ music_web_enable_wiz_miniplayer: false }, false);
  expect(answers()).toEqual([false, false]);
});

test('a page with no config at all is the old UI', () => {
  const window = new Window();
  globalThis.window = window as unknown as typeof globalThis.window;
  globalThis.document = window.document as unknown as Document;

  expect(answers()).toEqual([false, false]);
});
