import {
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  Show,
  Switch as SwitchFlow,
} from 'solid-js';

import { t } from '@/i18n';

import { NumberStepper, Switch, TextInput } from './Controls';
import { Icon } from './Icon';

import { liveFlags } from '../injectors/flags';
import { bridge, setAppValue, store } from '../state';

import type { FlagMetadata } from '@/types/flag-metadata';

const overrides = (): Record<string, unknown> =>
  store()?.options.featureFlags ?? {};

/** Save one override, and hand it to the page so it applies without a restart. */
const writeOverride = (name: string, value: unknown) => {
  setAppValue('options.featureFlags', { ...overrides(), [name]: value });
  window.__peardFeatureFlags?.set(name, value);
};

/** Drop one override; the page puts its own value back. */
const dropOverride = (name: string) => {
  const next = { ...overrides() };
  delete next[name];
  setAppValue('options.featureFlags', next);
  window.__peardFeatureFlags?.remove(name);
};

/** A typed value when the text is JSON, the text itself when it is not. */
const parseValue = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const FlagRow = (props: {
  name: string;
  meta?: FlagMetadata;
  onChanged: (name: string, requiresRestart: boolean) => void;
}) => {
  const overridden = () => Object.hasOwn(overrides(), props.name);
  /** What the flag is set to now: the override, or the page's own value. */
  const value = () =>
    overridden() ? overrides()[props.name] : liveFlags()[props.name];

  const commit = (next: unknown) => {
    writeOverride(props.name, next);
    props.onChanged(props.name, Boolean(props.meta?.requires_restart));
  };

  const undo = () => {
    dropOverride(props.name);
    props.onChanged(props.name, Boolean(props.meta?.requires_restart));
  };

  return (
    <div class="sui-field">
      <div class="sui-field__row">
        <div class="sui-field__text">
          <div class="sui-field__label-line">
            <span class="sui-field__label sui-flags__name">{props.name}</span>
            <Show when={props.meta?.family}>
              <span class="sui-pill sui-flags__family">
                {props.meta!.family}
              </span>
            </Show>
            <Show when={props.meta?.requires_restart}>
              <span class="sui-pill" title={t('settings-ui.restart-pill-hint')}>
                {t('settings-ui.restart-pill')}
              </span>
            </Show>
            <Show when={overridden()}>
              <span class="sui-pill">{t('settings-ui.flags.overridden')}</span>
            </Show>
          </div>
          <Show when={props.meta?.description}>
            <div class="sui-field__desc">{props.meta!.description}</div>
          </Show>
        </div>

        <Show when={typeof value() === 'boolean'}>
          <Switch
            checked={value() === true}
            label={props.name}
            onChange={commit}
          />
        </Show>

        <button
          class="sui-fieldbtn sui-flags__undo"
          disabled={!overridden()}
          onClick={undo}
          title={t('settings-ui.flags.undo-hint')}
          type="button"
        >
          {t('settings-ui.flags.undo')}
        </button>
      </div>

      <Show when={typeof value() !== 'boolean'}>
        <div class="sui-field__control">
          <SwitchFlow
            fallback={
              <TextInput
                onChange={(text) => {
                  try {
                    commit(JSON.parse(text));
                  } catch {
                    // Not valid JSON (yet): keep the stored value until it is.
                  }
                }}
                value={JSON.stringify(value()) ?? 'null'}
              />
            }
          >
            <Match when={typeof value() === 'number'}>
              <NumberStepper
                onChange={(number) => commit(number)}
                value={Number(value() ?? 0)}
              />
            </Match>
            <Match when={typeof value() === 'string'}>
              <TextInput
                onChange={(text) => commit(text)}
                value={String(value())}
              />
            </Match>
          </SwitchFlow>
        </div>
      </Show>
    </div>
  );
};

/**
 * Every flag the page carries, whatever the server sent this client, plus the ones
 * the user added. Deliberately outside the settings search: while it is open the
 * search box filters these flags, and no flag is reachable from any other section.
 */
export const FlagsSection = (props: {
  query: string;
  /** Reports a change so the modal can ask for a restart when one is needed. */
  onChanged: (name: string, requiresRestart: boolean) => void;
}) => {
  const query = () => props.query.trim();

  // Published at launch by the main process, which falls back to its cache.
  const [metadata] = createResource(() => bridge.flagMetadata());

  const allNames = createMemo(() =>
    [
      ...new Set([...Object.keys(liveFlags()), ...Object.keys(overrides())]),
    ].sort((a, b) => a.localeCompare(b)),
  );

  const names = createMemo(() => {
    const needle = query().toLowerCase();
    return needle
      ? allNames().filter((name) => name.toLowerCase().includes(needle))
      : allNames();
  });

  const [newName, setNewName] = createSignal('');
  const [newValue, setNewValue] = createSignal('true');

  /** Only a name no row already has: an existing one is edited on its own row. */
  const canAdd = () => {
    const name = newName().trim();
    return name.length > 0 && !allNames().includes(name);
  };

  const add = () => {
    if (!canAdd()) return;

    const name = newName().trim();
    writeOverride(name, parseValue(newValue()));
    props.onChanged(name, Boolean(metadata()?.[name]?.requires_restart));

    setNewName('');
    setNewValue('true');
  };

  return (
    <div class="sui-flags">
      {/* Shown every time the section is opened, never dismissed for good. */}
      <div class="sui-flags__warning" role="alert">
        <Icon name="warning" />
        <span>{t('settings-ui.flags.warning')}</span>
      </div>

      <div class="sui-flags__add">
        <input
          aria-label={t('settings-ui.flags.add-name')}
          class="sui-text sui-flags__add-name"
          onInput={(e) => setNewName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
          placeholder={t('settings-ui.flags.add-name')}
          type="text"
          value={newName()}
        />
        <input
          aria-label={t('settings-ui.flags.add-value')}
          class="sui-text sui-flags__add-value"
          onInput={(e) => setNewValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
          placeholder="true"
          title={t('settings-ui.flags.add-value-hint')}
          type="text"
          value={newValue()}
        />
        <button
          class="sui-fieldbtn"
          disabled={!canAdd()}
          onClick={add}
          type="button"
        >
          {t('settings-ui.flags.add')}
        </button>
      </div>

      <Show
        fallback={
          <div class="sui-empty">
            {query()
              ? t('settings-ui.flags.no-match', { query: query() })
              : t('settings-ui.flags.empty')}
          </div>
        }
        when={names().length > 0}
      >
        <div class="sui-group__card">
          <For each={names()}>
            {(name) => (
              <FlagRow
                meta={metadata()?.[name]}
                name={name}
                onChanged={props.onChanged}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
