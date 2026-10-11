import {
  createEffect,
  createResource,
  createSignal,
  For,
  Match,
  Show,
  Switch as SwitchFlow,
  type Component,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

import { t } from '@/i18n';
import {
  normalizeOrder,
  type ActionField,
  type CustomField,
  type CustomFieldContext,
  type FieldAccessors,
  type MultiSelectField,
  type NumberField,
  type OrderableField,
  type SelectField,
  type SettingField,
  type SettingOption,
  type SettingOptions,
  type SliderField,
  type TextField,
} from '@/types/settings';

import {
  CheckGroup,
  Dropdown,
  NumberStepper,
  RadioGroup,
  Slider,
  Switch,
  TextInput,
} from './Controls';
import { Icon } from './Icon';

import { bridge, pickDirectory, pickFile } from '../state';

interface SettingsFieldProps {
  field: SettingField;
  value: unknown;
  onChange: (value: unknown) => void;
  accessors?: FieldAccessors;
  /** Resolve a `"<pluginId>.<name>"` custom component. */
  resolveComponent?: (
    id: string,
  ) => Component<{ ctx: CustomFieldContext }> | undefined;
}

/** Resolve static or async option providers once per field. */
const useResolvedOptions = (getField: () => { options: SettingOptions }) => {
  const [options, { refetch }] = createResource(
    () => getField().options,
    async (opts) => (typeof opts === 'function' ? await opts() : opts),
    { initialValue: [] as SettingOption[] },
  );
  return { options, refetch };
};

/** A dynamic list can be re-read: by hand, or when a stored value goes missing. */
const isRefreshable = (field: {
  options: SettingOptions;
  refreshable?: boolean;
}) => typeof field.options === 'function' && field.refreshable !== false;

const SPIN_MIN_MS = 500;
const RefreshButton = (p: { onRefresh: () => unknown }) => {
  const [spinning, setSpinning] = createSignal(false);
  const run = async () => {
    if (spinning()) return;
    setSpinning(true);
    try {
      // The minimum dwell keeps the spin visible on an instant re-read; a failed
      // re-read keeps the list the field already has.
      await Promise.all([
        Promise.resolve(p.onRefresh()).catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, SPIN_MIN_MS)),
      ]);
    } finally {
      setSpinning(false);
    }
  };
  return (
    <button
      aria-label={t('settings-ui.refresh-options')}
      class="sui-refreshbtn"
      classList={{ 'sui-refreshbtn--spin': spinning() }}
      onClick={run}
      title={t('settings-ui.refresh-options')}
      type="button"
    >
      <Icon name="refresh" size={18} />
    </button>
  );
};

const SelectControl = (p: {
  field: SelectField;
  value: unknown;
  onChange: (value: unknown) => void;
}) => {
  const { options, refetch } = useResolvedOptions(() => p.field);
  const value = () => (p.value as string | number | undefined) ?? '';

  // A stored value missing from a dynamic list means the list is stale (a theme was
  // imported, a device plugged in): re-read once per value.
  let refreshedFor: unknown;
  createEffect(() => {
    const current = value();
    if (
      !isRefreshable(p.field) ||
      current === '' ||
      current === refreshedFor ||
      options().length === 0 ||
      options().some((option) => String(option.value) === String(current))
    ) {
      return;
    }

    refreshedFor = current;
    // A failed re-read keeps the last list; a rejection would otherwise leave the
    // resource errored, and every later options() read would throw.
    Promise.resolve(refetch()).catch(() => {});
  });

  // Same as the menu's Language > Sync entries: the backend reports unsupported
  // languages itself, and the value goes through the normal change path so the
  // restart banner and the store stay in step.
  const syncFromYouTube = async () => {
    const language = await bridge.languageFromYouTube();
    if (language) p.onChange(language);
  };

  return (
    <div class="sui-field__control">
      <div class="sui-control-row">
        <Show
          fallback={
            <RadioGroup
              onChange={p.onChange}
              options={options()}
              value={value()}
            />
          }
          when={p.field.variant === 'dropdown'}
        >
          <Dropdown onChange={p.onChange} options={options()} value={value()} />
        </Show>
        <Show when={isRefreshable(p.field)}>
          <RefreshButton onRefresh={() => refetch()} />
        </Show>
      </div>
      <Show when={p.field.languageSync}>
        <div class="sui-control-actions">
          <span>
            {t('main.menu.options.submenu.language.submenu.sync.label')}
          </span>
          <button class="sui-fieldbtn" onClick={syncFromYouTube} type="button">
            {t(
              'main.menu.options.submenu.language.submenu.sync.submenu.from-youtube',
            )}
          </button>
          <button
            class="sui-fieldbtn"
            onClick={() => bridge.languageToYouTube()}
            type="button"
          >
            {t(
              'main.menu.options.submenu.language.submenu.sync.submenu.to-youtube',
            )}
          </button>
        </div>
      </Show>
    </div>
  );
};

const SliderControl = (p: {
  field: SliderField;
  value: unknown;
  onChange: (value: unknown) => void;
}) => {
  const scale = () => p.field.scale ?? 1;
  const shown = () => Number(p.value ?? p.field.min) / scale();
  return (
    <div class="sui-field__control">
      <Slider
        display={`${shown()}${p.field.unit ? ' ' + p.field.unit : ''}`}
        max={p.field.max}
        min={p.field.min}
        onInput={(v) => p.onChange(v * scale())}
        step={p.field.step}
        value={shown()}
      />
    </div>
  );
};

const NumberControl = (p: {
  field: NumberField;
  value: unknown;
  onChange: (value: unknown) => void;
}) => (
  <div class="sui-field__control">
    <NumberStepper
      max={p.field.max}
      min={p.field.min}
      onChange={p.onChange}
      step={p.field.step}
      unit={p.field.unit}
      value={Number(p.value ?? p.field.min ?? 0)}
    />
  </div>
);

const TextControl = (p: {
  field: TextField;
  value: unknown;
  onChange: (value: unknown) => void;
}) => (
  <div class="sui-field__control">
    <TextInput
      onChange={p.onChange}
      placeholder={p.field.placeholder?.()}
      value={(p.value as string | undefined) ?? ''}
    />
  </div>
);

const MultiSelectControl = (p: {
  field: MultiSelectField;
  value: unknown;
  onChange: (value: unknown) => void;
}) => {
  const { options, refetch } = useResolvedOptions(() => p.field);
  return (
    <div class="sui-field__control">
      <div class="sui-control-row">
        <CheckGroup
          onChange={p.onChange}
          options={options()}
          values={
            Array.isArray(p.value) ? (p.value as SettingOption['value'][]) : []
          }
        />
        <Show when={isRefreshable(p.field)}>
          <RefreshButton onRefresh={() => refetch()} />
        </Show>
      </div>
    </div>
  );
};

const OrderableControl = (p: {
  field: OrderableField;
  value: unknown;
  onChange: (value: unknown) => void;
}) => {
  const { options } = useResolvedOptions(() => p.field);
  // Rows come from the stored order, so it survives a plugin adding options.
  const rows = () =>
    normalizeOrder(
      p.value as readonly unknown[] | undefined,
      options(),
      (option) => option.value,
    );

  const move = (from: number, to: number) => {
    const next = rows().map((row) => row.value);
    // Lifted out and inserted, so moving the first entry down puts it second.
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    p.onChange(next);
  };

  return (
    <div class="sui-field__control">
      <div aria-label={p.field.label()} class="sui-orderable" role="list">
        <For each={rows()}>
          {(row, index) => (
            <div class="sui-orderable__row" role="listitem">
              <span class="sui-orderable__label">{row.label()}</span>
              <button
                aria-label={t('settings-ui.move-up')}
                class="sui-refreshbtn sui-orderable__btn"
                disabled={index() === 0}
                onClick={() => move(index(), index() - 1)}
                type="button"
              >
                <Icon name="chevronUp" size={18} />
              </button>
              <button
                aria-label={t('settings-ui.move-down')}
                class="sui-refreshbtn sui-orderable__btn"
                disabled={index() === rows().length - 1}
                onClick={() => move(index(), index() + 1)}
                type="button"
              >
                <Icon name="chevronDown" size={18} />
              </button>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

/** The field's own read/write, plus the dialogs an `action` button may open. */
const ActionControl = (p: {
  field: ActionField;
  accessors?: FieldAccessors;
}) => (
  <div class="sui-field__control">
    <div class="sui-actions">
      <For each={p.field.buttons}>
        {(button) => (
          <button
            class="sui-fieldbtn"
            disabled={!p.accessors}
            onClick={() => {
              if (p.accessors) {
                button.onClick({ ...p.accessors, pickDirectory, pickFile });
              }
            }}
            type="button"
          >
            {button.label()}
          </button>
        )}
      </For>
    </div>
  </div>
);

const CustomControl = (p: {
  field: CustomField;
  accessors?: FieldAccessors;
  resolveComponent?: SettingsFieldProps['resolveComponent'];
}) => {
  const component = () => p.resolveComponent?.(p.field.component);
  return (
    <div class="sui-field__control">
      <Show
        fallback={
          <div class="sui-field__desc">
            missing component: {p.field.component}
          </div>
        }
        when={p.accessors ? component() : undefined}
      >
        {(comp) => <Dynamic component={comp()} ctx={p.accessors!} />}
      </Show>
    </div>
  );
};

export const SettingsField = (props: SettingsFieldProps) => {
  const field = () => props.field;

  return (
    <div
      class="sui-field"
      classList={{ 'sui-field--no-label': Boolean(field().hideLabel) }}
    >
      <div class="sui-field__row">
        <Show when={!field().hideLabel}>
          <div class="sui-field__text">
            <div class="sui-field__label-line">
              <span class="sui-field__label">{field().label()}</span>
              <Show when={field().restartNeeded}>
                <span
                  class="sui-pill"
                  title={t('settings-ui.restart-pill-hint')}
                >
                  {t('settings-ui.restart-pill')}
                </span>
              </Show>
            </div>
            <Show when={field().description}>
              <div class="sui-field__desc">{field().description!()}</div>
            </Show>
          </div>
        </Show>

        <Show when={field().type === 'switch'}>
          <Switch
            checked={Boolean(props.value)}
            label={field().label()}
            onChange={props.onChange}
          />
        </Show>
      </div>

      <SwitchFlow>
        <Match when={field().type === 'select'}>
          <SelectControl
            field={field() as SelectField}
            onChange={props.onChange}
            value={props.value}
          />
        </Match>

        <Match when={field().type === 'slider'}>
          <SliderControl
            field={field() as SliderField}
            onChange={props.onChange}
            value={props.value}
          />
        </Match>

        <Match when={field().type === 'number'}>
          <NumberControl
            field={field() as NumberField}
            onChange={props.onChange}
            value={props.value}
          />
        </Match>

        <Match when={field().type === 'text'}>
          <TextControl
            field={field() as TextField}
            onChange={props.onChange}
            value={props.value}
          />
        </Match>

        <Match when={field().type === 'multiselect'}>
          <MultiSelectControl
            field={field() as MultiSelectField}
            onChange={props.onChange}
            value={props.value}
          />
        </Match>

        <Match when={field().type === 'action'}>
          <ActionControl
            accessors={props.accessors}
            field={field() as ActionField}
          />
        </Match>

        <Match when={field().type === 'orderable'}>
          <OrderableControl
            field={field() as OrderableField}
            onChange={props.onChange}
            value={props.value}
          />
        </Match>

        <Match when={field().type === 'custom'}>
          <CustomControl
            accessors={props.accessors}
            field={field() as CustomField}
            resolveComponent={props.resolveComponent}
          />
        </Match>
      </SwitchFlow>
    </div>
  );
};
