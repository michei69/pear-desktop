// Copyright (c) 2026 bwedirhan. MIT License.
import { createSignal, For, onCleanup, Show } from 'solid-js';

import {
  forgetFiltered,
  normalizeChannels,
  readRecentFiltered,
  type ChannelEntry,
} from './config';

import type { CustomFieldContext } from '@/types/settings';

const rowStyle = {
  display: 'flex',
  'align-items': 'center',
  gap: '10px',
  'margin-bottom': '8px',
};
const nameStyle = { flex: '1', 'word-break': 'break-word' } as const;
const mutedStyle = { opacity: '0.6', 'font-size': '12px' } as const;
const linkBtn = {
  background: 'none',
  border: '1px solid currentColor',
  'border-radius': '6px',
  color: 'inherit',
  cursor: 'pointer',
  'font-size': '12px',
  padding: '2px 8px',
} as const;
const xBtn = {
  background: 'none',
  border: 'none',
  color: 'inherit',
  cursor: 'pointer',
  'font-size': '22px',
  padding: '0 6px',
} as const;

const Empty = (props: { text: string }) => (
  <div style={mutedStyle}>{props.text}</div>
);

const read = (ctx: CustomFieldContext, key: 'userBlock' | 'userAllow') =>
  normalizeChannels(ctx.getValue(key));

const allow = (ctx: CustomFieldContext, entry: ChannelEntry) => {
  ctx.setValue('userBlock', read(ctx, 'userBlock').filter((c) => c.id !== entry.id));
  if (!read(ctx, 'userAllow').some((c) => c.id === entry.id)) {
    ctx.setValue('userAllow', [...read(ctx, 'userAllow'), entry]);
  }
  forgetFiltered(entry.id);
};

const block = (ctx: CustomFieldContext, entry: ChannelEntry) => {
  ctx.setValue('userAllow', read(ctx, 'userAllow').filter((c) => c.id !== entry.id));
  if (!read(ctx, 'userBlock').some((c) => c.id === entry.id)) {
    ctx.setValue('userBlock', [...read(ctx, 'userBlock'), entry]);
  }
};

const Row = (props: {
  entry: ChannelEntry;
  note?: string;
  onAllow?: () => void;
  onBlock?: () => void;
  onRemove?: () => void;
}) => (
  <div style={rowStyle}>
    <span style={nameStyle}>
      {props.entry.name}
      <div style={mutedStyle}>
        {props.entry.id}
        {props.note ? ` · ${props.note}` : ''}
      </div>
    </span>
    <Show when={props.onAllow}>
      <button onClick={props.onAllow} style={linkBtn} type="button">
        Allow
      </button>
    </Show>
    <Show when={props.onBlock}>
      <button onClick={props.onBlock} style={linkBtn} type="button">
        Block
      </button>
    </Show>
    <Show when={props.onRemove}>
      <button
        aria-label="Remove"
        onClick={props.onRemove}
        style={xBtn}
        type="button"
      >
        ×
      </button>
    </Show>
  </div>
);

/** Channels that are always filtered (reported / "don't recommend" / added by hand). */
export const BlockedList = (props: { ctx: CustomFieldContext }) => {
  const list = () => read(props.ctx, 'userBlock');
  return (
    <div>
      <Show
        when={list().length}
        fallback={<Empty text="No blocked channels" />}
      >
        <For each={list()}>
          {(entry) => (
            <Row
              entry={entry}
              onAllow={() => allow(props.ctx, entry)}
              onRemove={() =>
                props.ctx.setValue(
                  'userBlock',
                  list().filter((c) => c.id !== entry.id),
                )
              }
            />
          )}
        </For>
      </Show>
    </div>
  );
};

/** Channels that are never filtered, even when a keyword or the list matches. */
export const AllowedList = (props: { ctx: CustomFieldContext }) => {
  const list = () => read(props.ctx, 'userAllow');
  return (
    <div>
      <Show
        when={list().length}
        fallback={<Empty text="No allowed channels" />}
      >
        <For each={list()}>
          {(entry) => (
            <Row
              entry={entry}
              onBlock={() => block(props.ctx, entry)}
              onRemove={() =>
                props.ctx.setValue(
                  'userAllow',
                  list().filter((c) => c.id !== entry.id),
                )
              }
            />
          )}
        </For>
      </Show>
    </div>
  );
};

/** Channels recently filtered by a keyword / the community list: fix false positives here. */
export const RecentList = (props: { ctx: CustomFieldContext }) => {
  const [tick, setTick] = createSignal(0);
  const timer = setInterval(() => setTick((n) => n + 1), 1500);
  onCleanup(() => clearInterval(timer));

  const list = () => {
    tick();
    const skip = new Set([
      ...read(props.ctx, 'userBlock').map((c) => c.id),
      ...read(props.ctx, 'userAllow').map((c) => c.id),
    ]);
    return readRecentFiltered().filter((e) => !skip.has(e.id));
  };

  return (
    <div>
      <Show
        when={list().length}
        fallback={<Empty text="No filtered channels yet" />}
      >
        <For each={list()}>
          {(entry) => (
            <Row
              entry={{ id: entry.id, name: entry.name }}
              note={entry.reason}
              onAllow={() => allow(props.ctx, { id: entry.id, name: entry.name })}
              onRemove={() => {
                forgetFiltered(entry.id);
                setTick((n) => n + 1);
              }}
            />
          )}
        </For>
      </Show>
    </div>
  );
};
