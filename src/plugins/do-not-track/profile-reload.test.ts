import { readFileSync } from 'node:fs';

import { test, expect } from '@playwright/test';
import { createInstance } from 'i18next';

import { createProfileReloadPrompt, profileKey } from './profile-reload';
import { blockers } from './types';

import type { TrackerBlockerConfig } from './index';

const config: TrackerBlockerConfig = {
  enabled: true,
  cache: true,
  blocker: blockers.Balanced,
  customEnabled: false,
  additionalBlockLists: [],
  additionalBlockListRules: [],
  disabledLocalBlockLists: [],
  disableDefaultLists: false,
};

test('only effective profile changes affect notification identity', () => {
  expect(profileKey({ ...config, cache: false })).toBe(profileKey(config));
  expect(profileKey({ ...config, additionalBlockListRules: ['fixture'] })).toBe(
    profileKey(config),
  );
  expect(profileKey({ ...config, blocker: blockers.Strict })).not.toBe(
    profileKey(config),
  );
  expect(profileKey({ ...config, customEnabled: true })).not.toBe(
    profileKey(config),
  );
  expect(
    profileKey({
      ...config,
      customEnabled: true,
      disabledLocalBlockLists: ['b', 'a'],
    }),
  ).toBe(
    profileKey({
      ...config,
      customEnabled: true,
      disabledLocalBlockLists: ['a', 'b'],
    }),
  );
});

test('Later and closing the dialog never reload; only explicit confirmation does', async () => {
  let response = 1;
  let reloads = 0;
  const prompt = createProfileReloadPrompt({
    show: (options) => {
      expect(options.defaultId).toBe(1);
      expect(options.cancelId).toBe(1);
      return Promise.resolve({ response, checkboxChecked: false });
    },
    translate: (key) => key,
    isActive: () => true,
    reload: () => {
      reloads++;
      return Promise.resolve();
    },
  });
  await prompt();
  expect(reloads).toBe(0);
  response = 0;
  await prompt();
  expect(reloads).toBe(1);
});

test('one dialog at a time; stale confirmation cannot reload a stopped plugin', async () => {
  let finish!: (value: Electron.MessageBoxReturnValue) => void;
  let dialogs = 0;
  let active = true;
  let reloads = 0;
  const prompt = createProfileReloadPrompt({
    show: () => {
      dialogs++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    translate: (key) => key,
    isActive: () => active,
    reload: () => {
      reloads++;
      return Promise.resolve();
    },
  });
  const pending = prompt();
  await prompt();
  expect(dialogs).toBe(1);
  active = false;
  finish({ response: 0, checkboxChecked: false });
  await pending;
  expect(reloads).toBe(0);
  await prompt();
  expect(dialogs).toBe(1);
});

test('dialog follows the current language and its English fallback', async () => {
  const i18n = createInstance();
  const resource = (lang: string) =>
    JSON.parse(
      readFileSync(
        new URL(`../../i18n/resources/${lang}.json`, import.meta.url),
        'utf8',
      ),
    ) as Record<string, unknown>;
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: { translation: resource('en') },
      ru: { translation: resource('ru') },
    },
  });
  const options: Electron.MessageBoxOptions[] = [];
  const prompt = createProfileReloadPrompt({
    show: (value) => {
      options.push(value);
      return Promise.resolve({ response: 1, checkboxChecked: false });
    },
    translate: (key) => i18n.t(key),
    isActive: () => true,
    reload: () => Promise.resolve(),
  });
  const titleKey = 'plugins.do-not-track.dialog.reload.title';

  await prompt();
  const englishTitle = options[0].title;
  // The dialog's own strings, not the wording the translation currently holds.
  expect(englishTitle).toBe(i18n.t(titleKey));

  await i18n.changeLanguage('ru');
  await prompt();
  expect(options[1].title).toBe(i18n.t(titleKey));
  expect(options[1].title).not.toBe(englishTitle);
  expect(options[1].buttons).toEqual([
    i18n.t('plugins.do-not-track.dialog.reload.reload-now'),
    i18n.t('main.dialog.need-to-restart.buttons.later'),
  ]);

  // A language with no resources keeps the English strings.
  await i18n.changeLanguage('missing');
  await prompt();
  expect(options[2].title).toBe(englishTitle);
});
