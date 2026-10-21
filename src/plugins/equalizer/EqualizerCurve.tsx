import { createMemo, createSignal, For, onCleanup, untrack } from 'solid-js';

import { t } from '@/i18n';

import {
  clamp,
  MAX_FREQUENCY,
  MAX_GAIN_DB,
  MAX_Q,
  MIN_FREQUENCY,
  MIN_GAIN_DB,
  MIN_Q,
  normalizeFilters,
  type EqualizerBand,
} from './config';
import { BAND_FREQUENCIES, DEFAULT_Q } from './presets';
import { interpolatedResponse } from './response';
import style from './style.css?inline';

import type { CustomFieldContext } from '@/types/settings';

const WIDTH = 720;
const HEIGHT = 250;
const PAD_X = 42;
const PAD_Y = 22;

const frequencyToX = (frequency: number) =>
  PAD_X +
  (Math.log10(clamp(frequency, MIN_FREQUENCY, MAX_FREQUENCY) / MIN_FREQUENCY) /
    Math.log10(MAX_FREQUENCY / MIN_FREQUENCY)) *
    (WIDTH - PAD_X * 2);

const xToFrequency = (x: number) =>
  MIN_FREQUENCY *
  (MAX_FREQUENCY / MIN_FREQUENCY) **
    ((clamp(x, PAD_X, WIDTH - PAD_X) - PAD_X) / (WIDTH - PAD_X * 2));

const gainToY = (gain: number) =>
  PAD_Y +
  ((MAX_GAIN_DB - clamp(gain, MIN_GAIN_DB, MAX_GAIN_DB)) /
    (MAX_GAIN_DB - MIN_GAIN_DB)) *
    (HEIGHT - PAD_Y * 2);

const yToGain = (y: number) =>
  MAX_GAIN_DB -
  ((clamp(y, PAD_Y, HEIGHT - PAD_Y) - PAD_Y) / (HEIGHT - PAD_Y * 2)) *
    (MAX_GAIN_DB - MIN_GAIN_DB);

const FREQUENCY_TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const GAIN_TICKS = [-30, -20, -10, 0, 10, 20, 30];
const BANDS_EVENT = 'peard:equalizer-bands';

const formatGain = (gain: number) =>
  `${gain > 0 ? '+' : ''}${gain.toFixed(1)} dB`;
const formatFrequency = (frequency: number) =>
  frequency >= 1000
    ? `${(frequency / 1000).toFixed(frequency >= 10000 ? 1 : 2)} kHz`
    : `${frequency.toFixed(frequency >= 100 ? 0 : 1)} Hz`;

export const EqualizerCurve = (props: { ctx: CustomFieldContext }) => {
  const [filters, setFilters] = createSignal<EqualizerBand[]>(
    untrack(() => normalizeFilters(props.ctx.getValue('filters'))),
  );
  const [notice, setNotice] = createSignal('');
  let svgElement: SVGSVGElement | undefined;
  let writeTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingFilters: EqualizerBand[] | undefined;

  const flush = () => {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = undefined;
    if (!pendingFilters) return;
    props.ctx.setValue('filters', pendingFilters);
    props.ctx.setValue('activePreset', 'custom');
    pendingFilters = undefined;
  };

  const persist = (next: EqualizerBand[]) => {
    pendingFilters = next;
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(flush, 120);
  };

  const updateBand = (index: number, patch: Partial<EqualizerBand>) => {
    setFilters((current) => {
      const next = current.map((band, bandIndex) =>
        bandIndex === index ? { ...band, ...patch } : band,
      );
      const normalized = normalizeFilters(next);
      persist(normalized);
      return normalized;
    });
  };

  const resetBand = (index: number) => {
    updateBand(index, {
      frequency: BAND_FREQUENCIES[index],
      gain: 0,
      Q: DEFAULT_Q,
    });
  };

  let endDrag: (() => void) | undefined;

  const startDrag = (event: PointerEvent, index: number) => {
    event.preventDefault();
    endDrag?.();
    const pointerId = event.pointerId;
    const start = {
      clientX: event.clientX,
      clientY: event.clientY,
      band: { ...filters()[index] },
    };
    // Capture on the stable SVG root. The circles are recreated as the curve
    // updates, so capturing (and listening) on the circle itself loses the
    // gesture as soon as the pointer leaves it.
    try {
      svgElement?.setPointerCapture(pointerId);
    } catch {
      // Pointer capture is an enhancement; window listeners below are the
      // fallback for browsers that refuse it.
    }

    const move = (moveEvent: Event) => {
      const pointerEvent = moveEvent as PointerEvent;
      if (pointerEvent.pointerId !== pointerId) return;
      const rect = svgElement?.getBoundingClientRect();
      if (!rect) return;
      const x = ((pointerEvent.clientX - rect.left) / rect.width) * WIDTH;
      const y = ((pointerEvent.clientY - rect.top) / rect.height) * HEIGHT;
      if (pointerEvent.shiftKey) {
        const q =
          start.band.Q * 2 ** ((pointerEvent.clientY - start.clientY) / 60);
        updateBand(index, { Q: clamp(q, MIN_Q, MAX_Q) });
      } else {
        updateBand(index, {
          frequency: xToFrequency(x),
          gain: yToGain(y),
        });
      }
    };
    const finish = (finishEvent?: Event) => {
      const pointerEvent = finishEvent as PointerEvent | undefined;
      if (
        pointerEvent?.pointerId !== undefined &&
        pointerEvent.pointerId !== pointerId
      ) {
        return;
      }
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finish);
      try {
        svgElement?.releasePointerCapture(pointerId);
      } catch {
        // Capture may already have been released by the browser.
      }
      endDrag = undefined;
      flush();
    };
    endDrag = finish;
    // Listen on the window, not the dot: the gesture must survive the pointer
    // leaving the circle, the SVG, and any DOM re-render while it is dragged.
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finish);
  };

  const curve = createMemo(() => {
    const points = interpolatedResponse(filters());
    return points
      .map(
        (point, index) =>
          `${index === 0 ? 'M' : 'L'} ${frequencyToX(point.frequency).toFixed(2)} ${gainToY(point.db).toFixed(2)}`,
      )
      .join(' ');
  });

  const onBandsEvent = (event: Event) => {
    const next = (event as CustomEvent<EqualizerBand[]>).detail;
    if (next) setFilters(normalizeFilters(next));
  };
  window.addEventListener(BANDS_EVENT, onBandsEvent);
  onCleanup(() => {
    window.removeEventListener(BANDS_EVENT, onBandsEvent);
    endDrag?.();
    flush();
  });

  const resetGains = () => {
    const next = filters().map((band) => ({ ...band, gain: 0 }));
    setFilters(next);
    persist(next);
    setNotice(t('plugins.equalizer.settings.gains-reset'));
  };

  return (
    <div class="sui-eq">
      <style>{style}</style>
      <div class="sui-eq__legend">
        <span>{t('plugins.equalizer.settings.curve-help')}</span>
        <button class="sui-outlinedbtn" onClick={resetGains} type="button">
          {t('plugins.equalizer.settings.reset-gains')}
        </button>
      </div>
      <div class="sui-eq__graph">
        <svg
          aria-label={t('plugins.equalizer.settings.curve-label')}
          class="sui-eq__svg"
          ref={(element) => (svgElement = element)}
          role="img"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          <rect
            class="sui-eq__plot"
            height={HEIGHT - PAD_Y * 2}
            width={WIDTH - PAD_X * 2}
            x={PAD_X}
            y={PAD_Y}
          />
          <For each={GAIN_TICKS}>
            {(gain) => (
              <>
                <line
                  class="sui-eq__grid"
                  x1={PAD_X}
                  x2={WIDTH - PAD_X}
                  y1={gainToY(gain)}
                  y2={gainToY(gain)}
                />
                <text
                  class="sui-eq__axis"
                  text-anchor="end"
                  x={PAD_X - 6}
                  y={gainToY(gain) + 4}
                >
                  {gain > 0 ? `+${gain}` : gain}
                </text>
              </>
            )}
          </For>
          <For each={FREQUENCY_TICKS}>
            {(frequency) => (
              <>
                <line
                  class="sui-eq__grid"
                  x1={frequencyToX(frequency)}
                  x2={frequencyToX(frequency)}
                  y1={PAD_Y}
                  y2={HEIGHT - PAD_Y}
                />
                <text
                  class="sui-eq__axis"
                  text-anchor="middle"
                  x={frequencyToX(frequency)}
                  y={HEIGHT - 5}
                >
                  {frequency >= 1000 ? `${frequency / 1000}k` : frequency}
                </text>
              </>
            )}
          </For>
          <line
            class="sui-eq__zero"
            x1={PAD_X}
            x2={WIDTH - PAD_X}
            y1={gainToY(0)}
            y2={gainToY(0)}
          />
          <path class="sui-eq__curve" d={curve()} />
          <For each={filters()}>
            {(band, index) => (
              <circle
                aria-label={`${index() + 1}: ${formatFrequency(band.frequency)}, ${formatGain(band.gain)}, Q ${band.Q.toFixed(2)}`}
                class="sui-eq__dot"
                classList={{
                  'sui-eq__dot--shelf':
                    band.type === 'lowshelf' || band.type === 'highshelf',
                }}
                cx={frequencyToX(band.frequency)}
                cy={gainToY(band.gain)}
                onDblClick={() => resetBand(index())}
                onPointerDown={(event) => startDrag(event, index())}
                r="7"
                tabindex="0"
              >
                <title>
                  {`${formatFrequency(band.frequency)} · ${formatGain(band.gain)} · Q ${band.Q.toFixed(2)}`}
                </title>
              </circle>
            )}
          </For>
        </svg>
      </div>
      <div class="sui-eq__bands">
        <For each={filters()}>
          {(band, index) => {
            const typeLabel = () =>
              band.type === 'lowshelf'
                ? t('plugins.equalizer.settings.low-shelf')
                : band.type === 'highshelf'
                  ? t('plugins.equalizer.settings.high-shelf')
                  : t('plugins.equalizer.settings.peaking');
            return (
              <fieldset class="sui-eq__band">
                <legend>
                  {index() + 1}. {formatFrequency(band.frequency)}
                </legend>
                <span class="sui-eq__type">{typeLabel()}</span>
                <label class="sui-eq__control">
                  <span>{t('plugins.equalizer.settings.frequency')}</span>
                  <input
                    aria-label={`${index() + 1} ${t('plugins.equalizer.settings.frequency')}`}
                    class="sui-text"
                    max={MAX_FREQUENCY}
                    min={MIN_FREQUENCY}
                    onChange={(event) =>
                      updateBand(index(), {
                        frequency: clamp(
                          event.currentTarget.valueAsNumber,
                          MIN_FREQUENCY,
                          MAX_FREQUENCY,
                        ),
                      })
                    }
                    step="0.1"
                    type="number"
                    value={Number(band.frequency.toFixed(2))}
                  />
                </label>
                <label class="sui-eq__control">
                  <span>{t('plugins.equalizer.settings.gain')}</span>
                  <input
                    aria-label={`${index() + 1} ${t('plugins.equalizer.settings.gain')}`}
                    aria-valuetext={formatGain(band.gain)}
                    class="sui-eq__range"
                    max={MAX_GAIN_DB}
                    min={MIN_GAIN_DB}
                    onInput={(event) =>
                      updateBand(index(), {
                        gain: event.currentTarget.valueAsNumber,
                      })
                    }
                    step="0.1"
                    type="range"
                    value={band.gain}
                  />
                  <input
                    aria-label={`${index() + 1} ${t('plugins.equalizer.settings.gain-number')}`}
                    class="sui-text sui-eq__number"
                    max={MAX_GAIN_DB}
                    min={MIN_GAIN_DB}
                    onChange={(event) =>
                      updateBand(index(), {
                        gain: clamp(
                          event.currentTarget.valueAsNumber,
                          MIN_GAIN_DB,
                          MAX_GAIN_DB,
                        ),
                      })
                    }
                    step="0.1"
                    type="number"
                    value={Number(band.gain.toFixed(1))}
                  />
                </label>
                <label class="sui-eq__control">
                  <span>{t('plugins.equalizer.settings.q')}</span>
                  <input
                    aria-label={`${index() + 1} ${t('plugins.equalizer.settings.q')}`}
                    class="sui-text sui-eq__number"
                    disabled={band.type !== 'peaking'}
                    max={MAX_Q}
                    min={MIN_Q}
                    onChange={(event) =>
                      updateBand(index(), {
                        Q: clamp(
                          event.currentTarget.valueAsNumber,
                          MIN_Q,
                          MAX_Q,
                        ),
                      })
                    }
                    step="0.01"
                    type="number"
                    value={Number(band.Q.toFixed(2))}
                  />
                </label>
                <button
                  aria-label={`${t('plugins.equalizer.settings.reset-band')} ${index() + 1}`}
                  class="sui-fieldbtn"
                  onClick={() => {
                    resetBand(index());
                    setNotice(
                      `${t('plugins.equalizer.settings.band-reset')} ${index() + 1}`,
                    );
                  }}
                  type="button"
                >
                  {t('plugins.equalizer.settings.reset-band')}
                </button>
              </fieldset>
            );
          }}
        </For>
      </div>
      <p aria-live="polite" class="sui-eq__notice">
        {notice()}
      </p>
    </div>
  );
};
