// Copyright (c) 2026 bwedirhan. MIT License.
import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js';

import {
  forgetFiltered,
  normalizeChannels,
  readBlacklistNames,
  type BlacklistName,
  type ChannelEntry,
} from './config';

import type { CustomFieldContext } from '@/types/settings';

const MIN_QUERY = 2; // nothing is listed until at least this many characters are typed
const MAX_RESULTS = 20;

const rowStyle = {
  display: 'flex',
  'align-items': 'center',
  gap: '10px',
  'margin-bottom': '6px',
};
const nameStyle = { flex: '1', 'word-break': 'break-word' } as const;
const mutedStyle = { opacity: '0.6', 'font-size': '12px' } as const;
const hintStyle = {
  opacity: '0.6',
  'font-size': '12px',
  'margin-top': '6px',
} as const;

const read = (ctx: CustomFieldContext, key: 'userBlock' | 'userAllow') =>
  normalizeChannels(ctx.getValue(key));

// A channel id allows the whole channel; a video id allows that one track
// (the filter checks both kinds of id against the allow list).
const allow = (ctx: CustomFieldContext, entry: ChannelEntry) => {
  // also drop block entries with the same name: the same channel can have a second
  // id (one on the community list, another that YouTube Music shows)
  const name = entry.name.trim().toLowerCase();
  ctx.setValue(
    'userBlock',
    read(ctx, 'userBlock').filter(
      (c) => c.id !== entry.id && c.name.trim().toLowerCase() !== name,
    ),
  );
  if (!read(ctx, 'userAllow').some((c) => c.id === entry.id)) {
    ctx.setValue('userAllow', [...read(ctx, 'userAllow'), entry]);
  }
  forgetFiltered(entry.id);
};

export const SearchBlocked = (props: { ctx: CustomFieldContext }) => {
  const [query, setQuery] = createSignal('');

  // While the names have not been saved yet (first run after an update), look
  // again every couple of seconds so results appear once the download finishes.
  const [tick, setTick] = createSignal(0);
  const timer = setInterval(() => {
    if (!readBlacklistNames().length) setTick((n) => n + 1);
  }, 2000);
  onCleanup(() => clearInterval(timer));

  const hasNames = () => {
    tick();
    return readBlacklistNames().length > 0;
  };

  const allowedIds = () => new Set(read(props.ctx, 'userAllow').map((c) => c.id));

  // Searches the already-parsed names kept in memory (a few thousand strings),
  // so typing never re-reads or re-parses storage. Name matches that start with
  // the text come first, then the other name matches, then matches on the id.
  const search = createMemo(() => {
    tick();
    const q = query().trim().toLowerCase();
    if (q.length < MIN_QUERY) return { shown: [] as BlacklistName[], total: 0 };
    const starts: BlacklistName[] = [];
    const inName: BlacklistName[] = [];
    const inId: BlacklistName[] = [];
    let total = 0;
    for (const item of readBlacklistNames()) {
      const pos = item.lower.indexOf(q);
      if (pos === -1 && !item.idLower.includes(q)) continue;
      total++;
      const bucket = pos === 0 ? starts : pos > 0 ? inName : inId;
      if (bucket.length < MAX_RESULTS) bucket.push(item);
    }
    return {
      shown: [...starts, ...inName, ...inId].slice(0, MAX_RESULTS),
      total,
    };
  });

  const toggle = (item: BlacklistName) => {
    const list = read(props.ctx, 'userAllow');
    if (list.some((c) => c.id === item.id)) {
      props.ctx.setValue('userAllow', list.filter((c) => c.id !== item.id));
    } else {
      allow(props.ctx, { id: item.id, name: item.name });
    }
  };

  return (
    <div>
      <input
        class="sui-text"
        onInput={(e) => setQuery(e.currentTarget.value)}
        placeholder="Type a name or paste a channel ID…"
        type="text"
        value={query()}
      />
      <Show when={!hasNames()}>
        <div style={hintStyle}>
          The community list hasn't been saved yet. It downloads when the app
          starts, so try again in a minute.
        </div>
      </Show>
      <Show
        when={hasNames() && query().trim().length >= MIN_QUERY && search().total === 0}
      >
        <div style={hintStyle}>No matches.</div>
      </Show>
      <Show when={search().shown.length > 0}>
        <div style={{ 'margin-top': '8px' }}>
          <For each={search().shown}>
            {(item) => (
              <div style={rowStyle}>
                <span style={nameStyle}>
                  {item.name}
                  <div style={mutedStyle}>
                    {item.kind === 'track' ? 'Track' : 'Channel'} · {item.id}
                  </div>
                </span>
                <span style={mutedStyle}>
                  {allowedIds().has(item.id) ? 'Allowed' : 'Allow'}
                </span>
                <button
                  aria-checked={allowedIds().has(item.id)}
                  aria-label={`Allow ${item.name}`}
                  class="sui-switch"
                  classList={{ 'sui-switch--on': allowedIds().has(item.id) }}
                  onClick={() => toggle(item)}
                  role="switch"
                  type="button"
                >
                  <span class="sui-switch__thumb" />
                </button>
              </div>
            )}
          </For>
          <Show when={search().total > search().shown.length}>
            <div style={hintStyle}>
              Showing {search().shown.length} of {search().total}. Type more to
              narrow it down.
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};
