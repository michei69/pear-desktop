import { For, onCleanup, Show } from 'solid-js';

import { t } from '@/i18n';

import type { SettingOption } from '@/types/settings';

type OptionValue = string | number;

export const Switch = (props: {
  checked: boolean;
  label?: string;
  onChange: (value: boolean) => void;
}) => (
  <button
    aria-checked={props.checked}
    aria-label={props.label}
    class="sui-switch"
    classList={{ 'sui-switch--on': props.checked }}
    onClick={() => props.onChange(!props.checked)}
    role="switch"
    type="button"
  >
    <span class="sui-switch__thumb" />
  </button>
);

export const RadioGroup = (props: {
  value: OptionValue;
  options: SettingOption[];
  onChange: (value: OptionValue) => void;
}) => (
  <div class="sui-chips">
    <For each={props.options}>
      {(opt) => (
        <button
          aria-pressed={props.value === opt.value}
          class="sui-chip"
          classList={{ 'sui-chip--selected': props.value === opt.value }}
          onClick={() => props.onChange(opt.value)}
          type="button"
        >
          {opt.label()}
        </button>
      )}
    </For>
  </div>
);

export const Dropdown = (props: {
  value: OptionValue;
  options: SettingOption[];
  onChange: (value: OptionValue) => void;
}) => {
  const emit = (raw: string) => {
    const opt = props.options.find((o) => String(o.value) === raw);
    props.onChange(opt ? opt.value : raw);
  };
  return (
    <select class="sui-select" onChange={(e) => emit(e.currentTarget.value)}>
      <For each={props.options}>
        {(opt) => (
          // `selected` per option rather than `value` on the <select>: options resolve
          // asynchronously, so an early value is dropped and the first option wins.
          <option
            selected={String(opt.value) === String(props.value)}
            value={String(opt.value)}
          >
            {opt.label()}
          </option>
        )}
      </For>
    </select>
  );
};

export const Slider = (props: {
  value: number;
  min: number;
  max: number;
  step?: number;
  display: string;
  onInput: (value: number) => void;
}) => {
  const progress = () =>
    ((props.value - props.min) / (props.max - props.min)) * 100;

  return (
    <div class="sui-slider-row">
      <div
        class="sui-slider-track"
        style={{ '--sui-slider-progress': `${progress()}%` }}
      >
        <input
          aria-valuetext={props.display}
          class="sui-slider"
          max={props.max}
          min={props.min}
          onInput={(e) => props.onInput(Number(e.currentTarget.value))}
          step={props.step ?? 1}
          type="range"
          value={props.value}
        />
      </div>
      <span class="sui-slider__value">{props.display}</span>
    </div>
  );
};

export const TextInput = (props: {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) => (
  <input
    class="sui-text"
    onChange={(e) => props.onChange(e.currentTarget.value)}
    placeholder={props.placeholder ?? ''}
    type="text"
    value={props.value}
  />
);

/** Held spinners repeat: a short delay, then a steady rate. */
const HOLD_DELAY_MS = 400;
const HOLD_REPEAT_MS = 70;

export const NumberStepper = (props: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}) => {
  const step = () => props.step ?? 1;
  const clamp = (v: number) => {
    let next = v;
    if (props.min !== undefined) next = Math.max(props.min, next);
    if (props.max !== undefined) next = Math.min(props.max, next);
    return next;
  };
  const set = (v: number) => {
    if (Number.isFinite(v)) props.onChange(clamp(v));
  };

  // Step once on press, then repeat while held, like the native spinners. Takes plain
  // numbers: the repeat must not read props.
  let holdTimer: number | undefined;
  const stopHold = () => {
    clearTimeout(holdTimer);
    holdTimer = undefined;
    window.removeEventListener('pointerup', stopHold);
    window.removeEventListener('pointercancel', stopHold);
    window.removeEventListener('blur', stopHold);
  };
  const holdToRepeat = (start: number, delta: number) => {
    stopHold();
    let next = start;
    set(next);
    // Self-rescheduling rather than an interval, so the delay is the only knob.
    const bump = () => {
      next = clamp(next + delta);
      set(next);
      holdTimer = window.setTimeout(bump, HOLD_REPEAT_MS);
    };
    holdTimer = window.setTimeout(bump, HOLD_DELAY_MS);
    // Release anywhere, or focus loss, has to end it.
    window.addEventListener('pointerup', stopHold);
    window.addEventListener('pointercancel', stopHold);
    window.addEventListener('blur', stopHold);
  };
  onCleanup(stopHold);

  return (
    <div class="sui-stepper">
      <button
        aria-label={t('settings-ui.stepper-decrement')}
        class="sui-stepper__btn"
        // Held pointers step on pointerdown; that click has detail 1 and is ignored,
        // leaving click to keyboard activation only.
        onClick={(e) => {
          if (e.detail === 0) set(props.value - step());
        }}
        onPointerDown={(e) => {
          if (e.button === 0)
            holdToRepeat(clamp(props.value - step()), -step());
        }}
        type="button"
      >
        −
      </button>
      <input
        class="sui-stepper__input"
        max={props.max}
        min={props.min}
        onChange={(e) => set(Number(e.currentTarget.value))}
        step={step()}
        type="number"
        value={props.value}
      />
      <Show when={props.unit}>
        <span class="sui-stepper__unit">{props.unit}</span>
      </Show>
      <button
        aria-label={t('settings-ui.stepper-increment')}
        class="sui-stepper__btn"
        onClick={(e) => {
          if (e.detail === 0) set(props.value + step());
        }}
        onPointerDown={(e) => {
          if (e.button === 0) holdToRepeat(clamp(props.value + step()), step());
        }}
        type="button"
      >
        +
      </button>
    </div>
  );
};

export const CheckGroup = (props: {
  values: OptionValue[];
  options: SettingOption[];
  onChange: (values: OptionValue[]) => void;
}) => {
  const toggle = (value: OptionValue) => {
    const set = new Set(props.values);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    props.onChange([...set]);
  };
  return (
    <div class="sui-chips">
      <For each={props.options}>
        {(opt) => (
          <button
            aria-pressed={props.values.includes(opt.value)}
            class="sui-chip"
            classList={{
              'sui-chip--selected': props.values.includes(opt.value),
            }}
            onClick={() => toggle(opt.value)}
            type="button"
          >
            {opt.label()}
          </button>
        )}
      </For>
    </div>
  );
};
