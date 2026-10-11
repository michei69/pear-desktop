/** Declarative settings schema for the in-app Settings modal. */

import type { Platform } from '@/types/plugins';

export interface SettingFieldBase {
  key: string;
  label: () => string;
  description?: () => string;
  /** Show a "restart" pill and flag the modal's restart banner when changed. */
  restartNeeded?: boolean;
  platform?: Platform;
  /** Render only while this is true, e.g. a control only some themes have. */
  visible?: () => boolean;
  /** Drop the label row above the control, for controls that name themselves. */
  hideLabel?: boolean;
}

export interface SwitchField extends SettingFieldBase {
  type: 'switch';
}

export interface SettingOption {
  value: string | number;
  label: () => string;
}

export type SettingOptions =
  | SettingOption[]
  | (() => SettingOption[] | Promise<SettingOption[]>);

export interface SelectField extends SettingFieldBase {
  type: 'select';
  /** `radio` renders inline chips (default), `dropdown` a native select. */
  variant?: 'radio' | 'dropdown';
  options: SettingOptions;
  /** Offer the refresh button and re-read the list when the stored value is missing from it; runtime lists only (files, devices). @default true */
  refreshable?: boolean;
  /** YouTube's own UI language, so offer the menu's "From YouTube" / "To YouTube" sync buttons. */
  languageSync?: boolean;
}

export interface SliderField extends SettingFieldBase {
  type: 'slider';
  min: number;
  max: number;
  step?: number;
  /** Suffix shown next to the value readout, e.g. `%`, `ms`, `min`. */
  unit?: string;
  /** Multiplier between displayed and stored value. @default 1 */
  scale?: number;
}

export interface TextField extends SettingFieldBase {
  type: 'text';
  placeholder?: () => string;
}

export interface MultiSelectField extends SettingFieldBase {
  type: 'multiselect';
  options: SettingOptions;
}

export interface NumberField extends SettingFieldBase {
  type: 'number';
  min?: number;
  max?: number;
  step?: number;
  /** Suffix shown next to the value, e.g. `ms`, `px`. */
  unit?: string;
  placeholder?: () => string;
}

export interface FieldAccessors {
  getValue: (key: string) => unknown;
  setValue: (key: string, value: unknown) => void;
}

/** What an `action` button is handed: the field's accessors plus the dialogs. */
export interface ActionHelpers extends FieldAccessors {
  pickDirectory: () => Promise<string | undefined>;
  pickFile: (
    filters?: { name: string; extensions: string[] }[],
  ) => Promise<string | undefined>;
}

export interface ActionButton {
  label: () => string;
  onClick: (helpers: ActionHelpers) => void | Promise<void>;
}

export interface ActionField extends SettingFieldBase {
  type: 'action';
  /** Rendered in one row. */
  buttons: ActionButton[];
}

export interface OrderableField extends SettingFieldBase {
  type: 'orderable';
  options: SettingOptions;
}

/**
 * `stored` first in its own order, then the declared entries it did not name, in
 * declared order. Unknown, stale and duplicate entries are dropped, so a list
 * saved before an entry existed still shows it, at the end.
 */
export const normalizeOrder = <T>(
  stored: readonly unknown[] | undefined,
  declared: readonly T[],
  valueOf: (item: T) => unknown = (item) => item,
): T[] => {
  const order = new Map<string, T>();
  for (const value of Array.isArray(stored) ? stored : []) {
    const item = declared.find(
      (candidate) => String(valueOf(candidate)) === String(value),
    );
    if (item !== undefined) order.set(String(valueOf(item)), item);
  }
  for (const item of declared) order.set(String(valueOf(item)), item);
  return [...order.values()];
};

export type CustomFieldContext = FieldAccessors;

export interface CustomField extends SettingFieldBase {
  type: 'custom';
  component: string;
}

export type SettingField =
  | SwitchField
  | SelectField
  | SliderField
  | TextField
  | MultiSelectField
  | NumberField
  | ActionField
  | OrderableField
  | CustomField;

export interface SettingsGroup {
  title?: () => string;
  fields: SettingField[];
}

/** A plugin's declared settings: a flat field list (one untitled group) or explicit titled groups. */
export type SettingsSchema = SettingField[] | SettingsGroup[];

export const isSettingsGroups = (
  schema: SettingsSchema,
): schema is SettingsGroup[] =>
  schema.length > 0 && 'fields' in (schema[0] as SettingsGroup);

/** Normalize a schema to a list of groups. */
export const toSettingsGroups = (schema: SettingsSchema): SettingsGroup[] =>
  isSettingsGroups(schema) ? schema : [{ fields: schema as SettingField[] }];
