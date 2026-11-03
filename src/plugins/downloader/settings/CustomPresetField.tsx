import { createSignal, untrack } from 'solid-js';

import { t } from '@/i18n';

import type { Preset } from '../types';
import type { CustomFieldContext } from '@/types/settings';

const normalize = (value: unknown): Preset => {
  const preset =
    typeof value === 'object' && value !== null
      ? (value as Partial<Preset>)
      : {};
  const extension =
    typeof preset.extension === 'string'
      ? preset.extension.trim().replace(/^\.+/, '')
      : '';

  return {
    extension: extension || null,
    ffmpegArgs: Array.isArray(preset.ffmpegArgs)
      ? preset.ffmpegArgs.filter(
          (argument): argument is string => typeof argument === 'string',
        )
      : [],
  };
};

const argsText = (preset: Preset) => preset.ffmpegArgs.join('\n');

export const CustomPresetField = (props: { ctx: CustomFieldContext }) => {
  const initial = untrack(() =>
    normalize(props.ctx.getValue('customPresetSetting')),
  );
  const [extension, setExtension] = createSignal(initial.extension ?? '');
  const [ffmpegArgs, setFfmpegArgs] = createSignal(argsText(initial));

  const save = (next: { extension?: string; ffmpegArgs?: string }) => {
    const customExtension = (next.extension ?? extension())
      .trim()
      .replace(/^\.+/, '');

    props.ctx.setValue('customPresetSetting', {
      extension: customExtension || null,
      ffmpegArgs: (next.ffmpegArgs ?? ffmpegArgs())
        .split('\n')
        .map((argument) => argument.trim())
        .filter(Boolean),
    } satisfies Preset);
  };

  return (
    <div class="sui-field__control" style={{ display: 'grid', gap: '6px' }}>
      <label class="sui-field__desc">
        {t('plugins.downloader.settings.custom-preset-extension')}
      </label>
      <input
        class="sui-text"
        onChange={(event) => {
          setExtension(event.currentTarget.value);
          save({ extension: event.currentTarget.value });
        }}
        placeholder="mp3"
        type="text"
        value={extension()}
      />
      <label class="sui-field__desc">
        {t('plugins.downloader.settings.custom-preset-ffmpeg-args')}
      </label>
      <textarea
        onChange={(event) => {
          setFfmpegArgs(event.currentTarget.value);
          save({ ffmpegArgs: event.currentTarget.value });
        }}
        placeholder="-b:a 256k"
        style={{
          'background': 'var(--sui-field-background, #2c2c2c)',
          'border': '1px solid var(--sui-field-border, #444)',
          'border-radius': '4px',
          'box-sizing': 'border-box',
          'color': 'inherit',
          'font-family': 'monospace',
          'font-size': '12px',
          'min-height': '72px',
          'padding': '6px',
          'resize': 'vertical',
          'width': '100%',
        }}
        value={ffmpegArgs()}
      />
      <span class="sui-field__desc">
        {t('plugins.downloader.settings.custom-preset-ffmpeg-args-description')}
      </span>
    </div>
  );
};
