/** The part of the page config the feature flags live in. */
interface YtcfgData {
  EXPERIMENT_FLAGS?: Record<string, unknown>;
  [key: string]: unknown;
}

/** YouTube Music's page config, as far as the feature flags need it. */
export interface Ytcfg {
  data_?: YtcfgData;
  d?: () => YtcfgData;
  set?: (key: string, value?: unknown) => void;
  /** Set once the flag patch is in place, so a re-patch is a no-op. */
  __peardFlags?: boolean;
}

/** Saved overrides, keyed by flag name. */
export type FeatureFlagOverrides = Record<string, unknown>;

/** What the injected installer leaves behind for the settings UI. */
export interface FeatureFlagsApi {
  /** Add or replace one override, and apply it live. */
  set: (name: string, value: unknown) => void;
  /** Drop one override, putting the page's own value back. */
  remove: (name: string) => void;
}

declare global {
  interface Window {
    ytcfg?: Ytcfg;
    __peardFeatureFlags?: FeatureFlagsApi;
  }
}

/** The flags the page is running with, overrides included. */
export const liveFlags = (): Record<string, unknown> =>
  window.ytcfg?.data_?.EXPERIMENT_FLAGS ?? {};

/**
 * Applies the user's overrides to YouTube Music's feature flags.
 *
 * Injected via `webFrame.executeJavaScript` before the page's own scripts run, so it is
 * stringified: it must stay self-contained and close over nothing. The overrides stay
 * mutable because the page re-sets EXPERIMENT_FLAGS as it goes and ours must win every
 * time; the settings UI drives them through the API below.
 */
export function installFeatureFlags(initial: FeatureFlagOverrides) {
  const overrides: FeatureFlagOverrides = { ...initial };

  /**
   * The page's own flags per config, as they came from the server: what Undo puts
   * back, so a flag the page carries keeps its default instead of being dropped.
   * Filled only from payloads the page handed over — the live map also holds our
   * overrides, so reading values back out of it would record those as its own.
   */
  const own = new WeakMap<Ytcfg, FeatureFlagOverrides>();

  /** Set while re-notifying the page, whose payload is ours, not the page's. */
  let syncing = false;

  /** The live flag map, created on the config when the page has none yet. */
  const flagsOf = (cfg?: Ytcfg): FeatureFlagOverrides => {
    const data = cfg?.data_ ?? cfg?.d?.() ?? {};
    const flags = data.EXPERIMENT_FLAGS;
    if (flags) return flags;

    const fresh: FeatureFlagOverrides = {};
    data.EXPERIMENT_FLAGS = fresh;
    return fresh;
  };

  const snapshotOf = (cfg: Ytcfg): FeatureFlagOverrides => {
    let snapshot = own.get(cfg);
    if (!snapshot) {
      snapshot = {};
      own.set(cfg, snapshot);
    }
    return snapshot;
  };

  /**
   * Keep the values the page just handed over. First value wins: what it sent
   * before an override was written is the page's own, anything after is ours.
   */
  const capture = (cfg: Ytcfg | undefined, source: unknown) => {
    if (!cfg || !source || typeof source !== 'object') return;

    const snapshot = snapshotOf(cfg);
    for (const [name, value] of Object.entries(source)) {
      if (!(name in snapshot)) snapshot[name] = value;
    }
  };

  const apply = (cfg?: Ytcfg) => {
    if (!cfg) return;
    Object.assign(flagsOf(cfg), overrides);
  };

  const patch = (cfg?: Ytcfg) => {
    if (!cfg || cfg.__peardFlags) return;

    const set = cfg.set?.bind(cfg);
    cfg.set = (...args: [string, unknown?]) => {
      set?.(...args);
      // A later EXPERIMENT_FLAGS payload would otherwise drop the overrides.
      if (!syncing && args[0] === 'EXPERIMENT_FLAGS') capture(cfg, args[1]);
      apply(cfg);
    };
    cfg.__peardFlags = true;
  };

  /** Re-apply, then tell the page's subscribers the flags changed. */
  const sync = () => {
    const cfg = window.ytcfg;
    if (!cfg) return;

    apply(cfg);
    syncing = true;
    try {
      cfg.set?.('EXPERIMENT_FLAGS', flagsOf(cfg));
    } finally {
      syncing = false;
    }
  };

  // The page's `ytcfg = window.ytcfg || { ... }` lands here.
  const existing = window.ytcfg;
  let current: Ytcfg | undefined;
  Object.defineProperty(window, 'ytcfg', {
    configurable: true,
    get: () => current,
    set: (value: Ytcfg) => {
      current = value;
      patch(value);
      capture(value, flagsOf(value));
      apply(value);
    },
  });
  // A config built before this ran (a reload, the dev server) is adopted as is.
  if (existing) window.ytcfg = existing;

  window.__peardFeatureFlags = {
    set: (name, value) => {
      overrides[name] = value;
      sync();
    },
    remove: (name) => {
      delete overrides[name];

      const cfg = window.ytcfg;
      if (!cfg) return;

      const flags = flagsOf(cfg);
      const snapshot = own.get(cfg);
      // A flag the page never had has no default to put back.
      if (snapshot && name in snapshot) flags[name] = snapshot[name];
      else delete flags[name];
      sync();
    },
  };
}
