/**
 * Dotted-path access, shared by app options (`options.proxy`) and plugin
 * config keys (`scrobblers.lastfm.apiKey`).
 */

export const getByPath = (obj: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === 'object'
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      obj,
    );

/** Writes `value` at a dotted path, creating the intermediate objects. */
export const setByPath = <T extends object>(
  root: T,
  path: string,
  value: unknown,
): T => {
  const keys = path.split('.');
  let node = root as Record<string, unknown>;

  for (const key of keys.slice(0, -1)) {
    if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }

  node[keys[keys.length - 1]] = value;
  return root;
};

/**
 * Copy-on-write set at a dotted path: clones only the objects along the path,
 * so a write costs the depth of the config rather than its size. Arrays are
 * copied as arrays.
 */
export const setByPathCopy = <T extends object>(
  root: T,
  path: string,
  value: unknown,
): T => {
  const clone = (node: unknown): Record<string, unknown> =>
    (Array.isArray(node)
      ? [...node]
      : node && typeof node === 'object'
        ? { ...node }
        : {}) as Record<string, unknown>;

  const keys = path.split('.');
  const copy = clone(root);
  let node = copy;

  for (const key of keys.slice(0, -1)) {
    node[key] = clone(node[key]);
    node = node[key] as Record<string, unknown>;
  }

  node[keys[keys.length - 1]] = value;
  return copy as T;
};

/** Build a nested partial object from a dotted key + value. */
export const nestPartial = (path: string, value: unknown): object =>
  setByPath({}, path, value);

/** One changed leaf of the config, as the dotted path it lives under. */
export type ConfigDelta = { path: string; value: unknown }[];

/**
 * The changed leaves between two configs, as dotted paths. Arrays and
 * non-objects are leaves, matching how the config merges them, so replacing an
 * array costs one delta instead of a walk.
 */
export const diffPaths = (
  oldValue: unknown,
  newValue: unknown,
  path: string,
  delta: ConfigDelta = [],
): ConfigDelta => {
  if (Object.is(oldValue, newValue)) return delta;

  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

  if (!isObject(oldValue) || !isObject(newValue)) {
    delta.push({ path, value: newValue });
    return delta;
  }

  for (const key of new Set([
    ...Object.keys(oldValue),
    ...Object.keys(newValue),
  ])) {
    const keyPath = path ? `${path}.${key}` : key;
    if (key in newValue)
      diffPaths(oldValue[key], newValue[key], keyPath, delta);
    else delta.push({ path: keyPath, value: undefined });
  }

  return delta;
};
