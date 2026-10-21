import { createSignal, For, Show, untrack } from 'solid-js';

import { t } from '@/i18n';

import {
  builtInProfile,
  clamp,
  flatProfile,
  MAX_OUTPUT_GAIN_DB,
  MAX_RECENT_PRESETS,
  MIN_OUTPUT_GAIN_DB,
  normalizeConfig,
  normalizeFilters,
  parsePresetImport,
  profilesMatch,
  type EqualizerBand,
  type UserPreset,
} from './config';
import { defaultPresets, type Preset } from './presets';
import style from './style.css?inline';

import type { CustomFieldContext } from '@/types/settings';

const BANDS_EVENT = 'peard:equalizer-bands';
const RESERVED_NAMES = new Set([
  'flat',
  'bass boost',
  'bass booster',
  'bass-booster',
]);

const presetLabel = (id: string, presets: UserPreset[]) => {
  if (id === 'flat') return t('plugins.equalizer.settings.flat');
  if (id === 'bass-booster') {
    return t('plugins.equalizer.menu.presets.list.bass-booster');
  }
  return presets.find((preset) => preset.id === id)?.name ?? id;
};

const dispatchFilters = (filters: EqualizerBand[]) => {
  window.dispatchEvent(
    new CustomEvent(BANDS_EVENT, {
      detail: structuredClone(filters),
    }),
  );
};

export const EqualizerPresets = (props: { ctx: CustomFieldContext }) => {
  const storedPresets = untrack(
    () =>
      normalizeConfig({
        userPresets: props.ctx.getValue('userPresets') as UserPreset[],
      }).userPresets,
  );
  const storedRecent = untrack(
    () =>
      normalizeConfig({
        recentPresets: props.ctx.getValue('recentPresets') as string[],
      }).recentPresets,
  );
  const initialActiveValue = untrack(() => props.ctx.getValue('activePreset'));
  const initialActive =
    typeof initialActiveValue === 'string' && initialActiveValue
      ? initialActiveValue
      : 'flat';

  const [userPresets, setUserPresets] =
    createSignal<UserPreset[]>(storedPresets);
  const [recentPresets, setRecentPresets] =
    createSignal<string[]>(storedRecent);
  const [activePreset, setActivePreset] = createSignal(initialActive);
  const [selectedPreset, setSelectedPreset] = createSignal(initialActive);
  const [presetName, setPresetName] = createSignal(
    storedPresets.find((preset) => preset.id === initialActive)?.name ?? '',
  );
  const [notice, setNotice] = createSignal('');

  const readFilters = () => normalizeFilters(props.ctx.getValue('filters'));
  const readOutputGain = () =>
    clamp(
      Number(props.ctx.getValue('outputGainDb') ?? 0),
      MIN_OUTPUT_GAIN_DB,
      MAX_OUTPUT_GAIN_DB,
    );
  const currentProfile = () => ({
    filters: readFilters(),
    outputGainDb: readOutputGain(),
  });
  const isDirty = () => {
    const id = activePreset();
    const profile =
      id === 'flat' || id === 'bass-booster'
        ? builtInProfile(id as Preset)
        : userPresets().find((preset) => preset.id === id);
    return profile ? !profilesMatch(currentProfile(), profile) : false;
  };
  const selectedUser = () =>
    userPresets().find((preset) => preset.id === selectedPreset());

  const remember = (id: string) => {
    const next = [id, ...recentPresets().filter((item) => item !== id)].slice(
      0,
      MAX_RECENT_PRESETS,
    );
    setRecentPresets(next);
    props.ctx.setValue('recentPresets', next);
  };

  const persistPresets = (next: UserPreset[]) => {
    setUserPresets(next);
    props.ctx.setValue('userPresets', next);
  };

  const applyProfile = (
    id: string,
    profile: { filters: EqualizerBand[]; outputGainDb?: number },
  ) => {
    const filters = normalizeFilters(profile.filters);
    props.ctx.setValue('filters', filters);
    if (profile.outputGainDb !== undefined) {
      props.ctx.setValue(
        'outputGainDb',
        clamp(profile.outputGainDb, MIN_OUTPUT_GAIN_DB, MAX_OUTPUT_GAIN_DB),
      );
    }
    props.ctx.setValue('activePreset', id);
    dispatchFilters(filters);
    setActivePreset(id);
    setSelectedPreset(id);
    setPresetName(userPresets().find((preset) => preset.id === id)?.name ?? '');
    remember(id);
    setNotice(
      `${t('plugins.equalizer.settings.applied')} ${presetLabel(id, userPresets())}`,
    );
  };

  const choosePreset = (id: string) => {
    if (!id || id === 'custom') return;
    if (id === 'flat' || id === 'bass-booster') {
      applyProfile(id, builtInProfile(id as Preset));
      return;
    }
    const preset = userPresets().find((item) => item.id === id);
    if (preset) applyProfile(id, preset);
  };

  const saveCurrent = () => {
    const name = presetName().trim();
    if (!name) {
      setNotice(t('plugins.equalizer.settings.name-required'));
      return;
    }
    if (RESERVED_NAMES.has(name.toLowerCase())) {
      setNotice(t('plugins.equalizer.settings.reserved-name'));
      return;
    }
    const existing = userPresets().find(
      (preset) => preset.name.toLowerCase() === name.toLowerCase(),
    );
    if (
      existing &&
      !window.confirm(t('plugins.equalizer.settings.confirm-replace'))
    ) {
      return;
    }
    const preset: UserPreset = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      ...currentProfile(),
    };
    const next = existing
      ? userPresets().map((item) => (item.id === existing.id ? preset : item))
      : [...userPresets(), preset];
    persistPresets(next);
    props.ctx.setValue('activePreset', preset.id);
    dispatchFilters(preset.filters);
    setActivePreset(preset.id);
    setSelectedPreset(preset.id);
    remember(preset.id);
    setNotice(`${t('plugins.equalizer.settings.saved')} ${name}`);
  };

  const renameSelected = () => {
    const selected = selectedUser();
    const name = presetName().trim();
    if (!selected || !name) {
      setNotice(t('plugins.equalizer.settings.select-user-preset'));
      return;
    }
    if (RESERVED_NAMES.has(name.toLowerCase())) {
      setNotice(t('plugins.equalizer.settings.reserved-name'));
      return;
    }
    if (
      userPresets().some(
        (preset) =>
          preset.id !== selected.id &&
          preset.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      setNotice(t('plugins.equalizer.settings.name-exists'));
      return;
    }
    const next = userPresets().map((preset) =>
      preset.id === selected.id ? { ...preset, name } : preset,
    );
    persistPresets(next);
    setNotice(`${t('plugins.equalizer.settings.renamed')} ${name}`);
  };

  const deleteSelected = () => {
    const selected = selectedUser();
    if (!selected) {
      setNotice(t('plugins.equalizer.settings.select-user-preset'));
      return;
    }
    if (!window.confirm(t('plugins.equalizer.settings.confirm-delete'))) {
      return;
    }
    const next = userPresets().filter((preset) => preset.id !== selected.id);
    persistPresets(next);
    const nextRecent = recentPresets().filter((item) => item !== selected.id);
    setRecentPresets(nextRecent);
    props.ctx.setValue('recentPresets', nextRecent);
    if (activePreset() === selected.id || selectedPreset() === selected.id) {
      setActivePreset('custom');
      setSelectedPreset('custom');
      props.ctx.setValue('activePreset', 'custom');
      setPresetName('');
    }
    setNotice(`${t('plugins.equalizer.settings.deleted')} ${selected.name}`);
  };

  const exportPresets = () => {
    const file = new Blob(
      [JSON.stringify({ version: 1, presets: userPresets() }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'pear-equalizer-presets.json';
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice(t('plugins.equalizer.settings.exported'));
  };

  const importPresets = async (file: File | undefined) => {
    if (!file) return;
    try {
      const imported = parsePresetImport(await file.text());
      if (imported.length === 0) {
        setNotice(t('plugins.equalizer.settings.import-empty'));
        return;
      }
      const next = [...userPresets()];
      for (const preset of imported) {
        let name = preset.name;
        if (
          next.some((item) => item.name.toLowerCase() === name.toLowerCase())
        ) {
          name = `${name} (${t('plugins.equalizer.settings.imported-suffix')})`;
        }
        next.push({
          ...preset,
          id: next.some((item) => item.id === preset.id)
            ? crypto.randomUUID()
            : preset.id,
          name: name.slice(0, 80),
        });
      }
      persistPresets(next);
      setNotice(
        `${t('plugins.equalizer.settings.imported')} ${imported.length}`,
      );
    } catch {
      setNotice(t('plugins.equalizer.settings.import-error'));
    }
  };

  const resetEq = () => {
    const profile = flatProfile();
    applyProfile('flat', profile);
    setPresetName('');
    setNotice(t('plugins.equalizer.settings.reset-done'));
  };

  const options = () => [
    { id: 'custom', label: t('plugins.equalizer.settings.custom') },
    ...defaultPresets.map((id) => ({
      id,
      label: presetLabel(id, userPresets()),
    })),
    ...userPresets().map((preset) => ({
      id: preset.id,
      label: preset.name,
    })),
  ];

  return (
    <div class="sui-eq-presets">
      <style>{style}</style>
      <div class="sui-eq-presets__row">
        <label class="sui-eq-presets__field">
          <span>{t('plugins.equalizer.settings.preset')}</span>
          <select
            aria-label={t('plugins.equalizer.settings.preset')}
            class="sui-select"
            onChange={(event) => {
              setSelectedPreset(event.currentTarget.value);
              choosePreset(event.currentTarget.value);
            }}
            value={selectedPreset()}
          >
            <For each={options()}>
              {(option) => (
                <option value={option.id}>
                  {option.label}
                  {option.id === activePreset() && isDirty() ? ' •' : ''}
                </option>
              )}
            </For>
          </select>
        </label>
        <label class="sui-eq-presets__field sui-eq-presets__name">
          <span>{t('plugins.equalizer.settings.preset-name')}</span>
          <input
            aria-label={t('plugins.equalizer.settings.preset-name')}
            class="sui-text"
            maxlength="80"
            onInput={(event) => setPresetName(event.currentTarget.value)}
            placeholder={t(
              'plugins.equalizer.settings.preset-name-placeholder',
            )}
            type="text"
            value={presetName()}
          />
        </label>
      </div>
      <div class="sui-eq-presets__actions">
        <button class="sui-outlinedbtn" onClick={saveCurrent} type="button">
          {t('plugins.equalizer.settings.save-current')}
        </button>
        <button
          class="sui-outlinedbtn"
          disabled={!selectedUser()}
          onClick={renameSelected}
          type="button"
        >
          {t('plugins.equalizer.settings.rename')}
        </button>
        <button
          class="sui-outlinedbtn"
          disabled={!selectedUser()}
          onClick={deleteSelected}
          type="button"
        >
          {t('plugins.equalizer.settings.delete')}
        </button>
        <button class="sui-outlinedbtn" onClick={resetEq} type="button">
          {t('plugins.equalizer.settings.reset-eq')}
        </button>
        <button class="sui-outlinedbtn" onClick={exportPresets} type="button">
          {t('plugins.equalizer.settings.export')}
        </button>
        <label class="sui-outlinedbtn sui-eq-presets__import">
          {t('plugins.equalizer.settings.import')}
          <input
            accept="application/json,.json"
            onChange={(event) => {
              importPresets(event.currentTarget.files?.[0]).catch(() => {});
              event.currentTarget.value = '';
            }}
            type="file"
          />
        </label>
      </div>
      <Show when={recentPresets().length > 0}>
        <div class="sui-eq-presets__recent">
          <span>{t('plugins.equalizer.settings.recent')}</span>
          <For each={recentPresets()}>
            {(id) => (
              <button
                class="sui-chip"
                classList={{ 'sui-chip--selected': activePreset() === id }}
                onClick={() => {
                  setSelectedPreset(id);
                  choosePreset(id);
                }}
                type="button"
              >
                {presetLabel(id, userPresets())}
              </button>
            )}
          </For>
        </div>
      </Show>
      <p aria-live="polite" class="sui-eq__notice">
        {notice()}
      </p>
    </div>
  );
};
