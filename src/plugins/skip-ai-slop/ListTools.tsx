// Copyright (c) 2026 bwedirhan. MIT License.
import { createSignal, onCleanup, onMount } from 'solid-js';

import {
  EVT_CLEAR,
  EVT_DOWNLOAD,
  EVT_INFO,
  EVT_STATUS,
  type ListStatus,
} from './config';

const rowStyle = {
  display: 'flex',
  gap: '10px',
  'flex-wrap': 'wrap',
  'margin-bottom': '8px',
};
const btnStyle = {
  background: 'none',
  border: '1px solid currentColor',
  'border-radius': '6px',
  color: 'inherit',
  cursor: 'pointer',
  'font-size': '13px',
  padding: '4px 12px',
} as const;
const mutedStyle = { opacity: '0.7', 'font-size': '12px' } as const;

/** Buttons to re-download the community list or wipe its saved copy. */
export const ListTools = () => {
  const [status, setStatus] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  const onStatus = (e: Event) => {
    const detail = (e as CustomEvent<ListStatus>).detail;
    setStatus(detail?.text ?? '');
    setBusy(!!detail?.busy);
  };
  onMount(() => {
    window.addEventListener(EVT_STATUS, onStatus);
    window.dispatchEvent(new CustomEvent(EVT_INFO)); // ask what is loaded right now
  });
  onCleanup(() => window.removeEventListener(EVT_STATUS, onStatus));

  return (
    <div>
      <div style={rowStyle}>
        <button
          disabled={busy()}
          onClick={() => window.dispatchEvent(new CustomEvent(EVT_DOWNLOAD))}
          style={btnStyle}
          type="button"
        >
          Download list now
        </button>
        <button
          disabled={busy()}
          onClick={() => window.dispatchEvent(new CustomEvent(EVT_CLEAR))}
          style={btnStyle}
          type="button"
        >
          Clear cache
        </button>
      </div>
      <div style={mutedStyle}>{status()}</div>
    </div>
  );
};
