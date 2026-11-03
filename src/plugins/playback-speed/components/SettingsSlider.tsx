import { createSignal, onMount } from 'solid-js';

import {
  formatPlaybackSpeed,
  normalizePlaybackSpeed,
  SETTINGS_MAX_PLAYBACK_SPEED,
  SETTINGS_MIN_PLAYBACK_SPEED,
} from '../speed';

import type { CustomFieldContext } from '@/types/settings';

const STEP = 0.05;

export const SettingsSlider = (props: { ctx: CustomFieldContext }) => {
  const [speed, setSpeed] = createSignal(1);

  onMount(() =>
    setSpeed(normalizePlaybackSpeed(props.ctx.getValue('playbackSpeed'))),
  );

  const progress = () =>
    ((speed() - SETTINGS_MIN_PLAYBACK_SPEED) /
      (SETTINGS_MAX_PLAYBACK_SPEED - SETTINGS_MIN_PLAYBACK_SPEED)) *
    100;

  return (
    <div class="sui-slider-row">
      <div
        class="sui-slider-track"
        style={{ '--sui-slider-progress': `${progress()}%` }}
      >
        <input
          aria-valuetext={formatPlaybackSpeed(speed())}
          class="sui-slider"
          max={SETTINGS_MAX_PLAYBACK_SPEED}
          min={SETTINGS_MIN_PLAYBACK_SPEED}
          onChange={() => props.ctx.setValue('playbackSpeed', speed())}
          onInput={(event) => setSpeed(Number(event.currentTarget.value))}
          step={STEP}
          type="range"
          value={speed()}
        />
      </div>
      <span class="sui-slider__value">{formatPlaybackSpeed(speed())}</span>
    </div>
  );
};
