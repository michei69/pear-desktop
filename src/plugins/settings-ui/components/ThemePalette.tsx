import { createSignal, For, Show } from 'solid-js';

import { t } from '@/i18n';
import { CUSTOM_PRESET, keyLabel, presetPalette } from '@/themes/types';

import {
  bridge,
  patchLocal,
  selectedTheme,
  store,
  themeOverrides,
  themePalette,
  themePresetNames,
  themePresets,
} from '../state';

import type { CustomFieldContext } from '@/types/settings';

const themeLabel = (key: string) =>
  `main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.${key}`;

/**
 * Editor for the selected theme's palette: one text input per variable, which is
 * the theme's, the preset's, or the user's own value. Editing a value or adding one
 * makes the palette the user's own, so the preset pick (its own field under the theme)
 * switches to Custom.
 */
export const ThemePaletteField = (_props: { ctx: CustomFieldContext }) => {
  const selectedId = () => store()?.options.theme ?? '';

  const palette = themePalette;
  const keys = () => Object.keys(palette());

  /**
   * Writes one custom value. Main seeds the custom palette the same way, so editing
   * while a preset is picked keeps the rest of that preset.
   */
  const setValue = async (key: string, value: string) => {
    const themeId = selectedId();
    const theme = selectedTheme();
    const custom = {
      ...presetPalette(
        theme?.palette,
        themePresets(),
        themePresetNames()[themeId],
        themeOverrides()[themeId] ?? {},
      ),
      [key]: value,
    };

    patchLocal('options.themePresets', {
      ...themePresetNames(),
      [themeId]: CUSTOM_PRESET,
    });
    patchLocal('options.themeOverrides', {
      ...themeOverrides(),
      [themeId]: custom,
    });
    await bridge.setThemeColor(themeId, key, value);
  };

  const reset = async () => {
    const themeId = selectedId();
    const next = { ...themeOverrides() };
    delete next[themeId];
    patchLocal('options.themeOverrides', next);
    patchLocal('options.themePresets', {
      ...themePresetNames(),
      [themeId]: '',
    });
    await bridge.resetThemeColors(themeId);
  };

  const [newKey, setNewKey] = createSignal('');
  const [newValue, setNewValue] = createSignal('');

  const addVariable = async () => {
    const key = newKey().trim();
    if (!key) return;

    await setValue(key, newValue());
    setNewKey('');
    setNewValue('');
  };

  return (
    <Show when={keys().length > 0}>
      <div class="sui-palette">
        <For each={keys()}>
          {(key) => (
            <label class="sui-palette__row">
              <span class="sui-palette__key">{keyLabel(key)}</span>
              <input
                class="sui-text"
                onChange={(e) => setValue(key, e.currentTarget.value)}
                type="text"
                value={palette()[key] ?? ''}
              />
              <span
                class="sui-palette__swatch"
                style={{ background: palette()[key] }}
              />
            </label>
          )}
        </For>
        <div class="sui-palette__row">
          <input
            class="sui-text sui-palette__name"
            onInput={(e) => setNewKey(e.currentTarget.value)}
            placeholder={t('settings-ui.fields.theme-variable-name')}
            type="text"
            value={newKey()}
          />
          <input
            class="sui-text"
            onInput={(e) => setNewValue(e.currentTarget.value)}
            placeholder={t('settings-ui.fields.theme-variable-value')}
            type="text"
            value={newValue()}
          />
          <button class="sui-outlinedbtn" onClick={addVariable} type="button">
            {t('settings-ui.fields.theme-variable-add')}
          </button>
        </div>
        <button class="sui-outlinedbtn" onClick={reset} type="button">
          {t(themeLabel('reset-colors'))}
        </button>
      </div>
    </Show>
  );
};
