// Copyright (c) 2026 bwedirhan. MIT License.
import { createSignal, For } from 'solid-js';

import { normalizeKeywords, type KeywordEntry } from './config';

import type { CustomFieldContext } from '@/types/settings';

const rowStyle = {
  display: 'flex',
  'align-items': 'center',
  gap: '10px',
  'margin-bottom': '8px',
};

export const KeywordList = (props: { ctx: CustomFieldContext }) => {
  const list = () => normalizeKeywords(props.ctx.getValue('keywords'));
  const save = (next: KeywordEntry[]) => props.ctx.setValue('keywords', next);
  const [draft, setDraft] = createSignal('');

  const add = () => {
    const text = draft().trim();
    if (!text) return;
    const exists = list().some((k) => k.text.toLowerCase() === text.toLowerCase());
    if (!exists) save([...list(), { text, enabled: true }]);
    setDraft('');
  };

  return (
    <div>
      <For each={list()}>
        {(entry, i) => (
          <div style={rowStyle}>
            <span style={{ flex: '1', 'word-break': 'break-word' }}>
              {entry.text}
            </span>
            <button
              aria-checked={entry.enabled}
              aria-label={entry.text}
              class="sui-switch"
              classList={{ 'sui-switch--on': entry.enabled }}
              onClick={() =>
                save(
                  list().map((k, idx) =>
                    idx === i() ? { ...k, enabled: !k.enabled } : k,
                  ),
                )
              }
              role="switch"
              type="button"
            >
              <span class="sui-switch__thumb" />
            </button>
            <button
              aria-label="Delete"
              onClick={() => save(list().filter((_, idx) => idx !== i()))}
              style={{
                background: 'none',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                'font-size': '22px',
                padding: '0 6px',
              }}
              type="button"
            >
              ×
            </button>
          </div>
        )}
      </For>

      <input
        class="sui-text"
        onChange={add}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
        placeholder="Add a keyword... (press Enter)"
        type="text"
        value={draft()}
      />
    </div>
  );
};
