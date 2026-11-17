// Building blocks of the migrations. Old config stored only non-defaults
// (deep-merged on read), so any key may be missing: values are type-checked and
// existing keys are never overwritten, so running a migration twice changes nothing.

import { clamp } from "@pear/sdk/util";

export type Json = Record<string, unknown>;

export interface StoredConfig {
  plugins?: Record<string, Json>;
  options?: Json;
  url?: unknown;
  "window-size"?: unknown;
  "window-position"?: unknown;
  "window-maximized"?: unknown;
  __internal__?: { migrations?: { version?: string } };
  [key: string]: unknown;
}

/** Files next to config.json a migration creates (name -> JSON), written only if missing. */
export type MigratedFiles = Record<string, unknown>;

export const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
export const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export const isString = (value: unknown): value is string => typeof value === "string";
export const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
export const isPair = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every(isNumber);

/** The plugin's stored entry, created empty if there is none. */
export function ensurePluginEntry(config: StoredConfig, id: string): Json {
  config.plugins ??= {};
  return (config.plugins[id] ??= {});
}

/** Sets a new key, unless the entry already has one. */
export function setNew(entry: Json, key: string, value: unknown) {
  if (value !== undefined && !(key in entry)) entry[key] = value;
}

/** Copies the values of `from` that pass `guard` onto new keys of the entry (old name → new name). */
export function copyTyped(entry: Json, from: unknown, mapping: Readonly<Record<string, string>>, guard: (value: unknown) => boolean) {
  if (!isRecord(from)) return;
  for (const [oldKey, newKey] of Object.entries(mapping)) {
    if (guard(from[oldKey])) setNew(entry, newKey, from[oldKey]);
  }
}

/** Copies the string values of `from` onto the entry's top-level keys. */
export function flattenStrings(entry: Json, from: unknown, mapping: Readonly<Record<string, string>>) {
  copyTyped(entry, from, mapping, isString);
}

/** A flag name `siteFlags` entries can hold (the same names core-config accepts). */
const FLAG_NAME = /^[\w.-]+$/;

/**
 * A feature-flag overrides record -> "name=value" `siteFlags` entries. A boolean
 * or finite number reads back as itself; a string is raw text (the list has no
 * quoting, so text that looks like a number or boolean reads back as one); other
 * values become their JSON text. A name that would not parse back is left out; the
 * old record stays in the file.
 */
export function siteFlagEntries(flags: Json): string[] {
  const entries: string[] = [];
  for (const [name, value] of Object.entries(flags)) {
    if (!FLAG_NAME.test(name) || value === undefined) continue;
    entries.push(`${name}=${flagText(value)}`);
  }
  return entries;
}

function flagText(value: unknown): string {
  if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? String(value);
}

/** Old fractions (0.5) -> percentages (50). */
export function fractionToPercent(entry: Json, key: string) {
  const value = entry[key];
  if (isNumber(value) && value >= 0 && value <= 1) entry[key] = Math.round(value * 100);
}

/** Keeps an out-of-range number within the range (it would otherwise reset to its default). */
export function clampNumber(entry: Json, key: string, min: number, max: number) {
  const value = clampedValue(entry[key], min, max);
  if (value !== undefined) entry[key] = value;
}

export function clampedValue(value: unknown, min: number, max: number) {
  return isNumber(value) ? clamp(value, min, max) : undefined;
}
