// YTM's feature flags ("experiments"): the page's inline config script hands
// them to `ytcfg.set({ EXPERIMENT_FLAGS })`, and YTM's code reads them from
// `yt.config_` afterwards. The runtime runs before that script, so it wraps
// `ytcfg`/`ytcfg.set` as soon as the page defines them, and the user's overrides
// (and performance mode's) land in the flags before anything reads them.
//
// The settings UI's Flags section changes overrides live through
// `window.__pearFeatureFlags`: the overrides stay mutable, so a later payload
// from the page keeps them too.
//
// Only flags YTM's own code reads change anything; the server decides the rest.

import { type ConfigOf, normalizeConfig } from "@pear/sdk";
import { flagOverrides, SITE, type FlagValue, type Flags } from "@pear/sdk/core-config";
import type { LiveFeatureFlags } from "@pear/sdk/protocol";
import { performanceModeFeatureFlags } from "./performance.ts";

type SiteConfig = ConfigOf<typeof SITE>;

/**
 * The flags behind the "Player bar" setting. YTM hands them out together:
 * without the action bar flag the new bar has no like buttons.
 */
const NEW_PLAYER_BAR = [
  "music_web_enable_wiz_miniplayer",
  "music_web_enable_action_bar_view_model_in_player_overlay",
  "music_web_enable_like_count_in_player_overlay",
  "music_web_enable_contained_content_layout",
];
const allSetTo = (value: boolean): Flags => Object.fromEntries(NEW_PLAYER_BAR.map((name) => [name, value]));

const PLAYER_BAR_FLAGS: Record<Exclude<SiteConfig["playerBar"], "">, Flags> = {
  classic: allSetTo(false),
  new: allSetTo(true),
};

/** The overrides the settings (the core "site" section) ask for; the list wins over the named settings. */
export function siteOverrides(stored: Record<string, unknown>): Flags {
  const config = normalizeConfig(SITE, stored);
  const named = config.playerBar ? PLAYER_BAR_FLAGS[config.playerBar] : {};
  return { ...named, ...flagOverrides(config.siteFlags) };
}

declare global {
  interface Window {
    ytcfg?: Ytcfg;
    /** The live API the settings UI's Flags section uses; only in YTM's page. */
    __pearFeatureFlags?: LiveFeatureFlags;
  }
}

/** The part of the page config the feature flags live in. */
interface Ytcfg {
  data_?: { EXPERIMENT_FLAGS?: Flags; INNERTUBE_CLIENT_VERSION?: string };
  d?: () => { EXPERIMENT_FLAGS?: Flags; INNERTUBE_CLIENT_VERSION?: string };
  set?: (key: string, value?: unknown) => unknown;
  /** Set once the flag patch is in place, so a re-patch is a no-op. */
  __pearFlags?: boolean;
}

export interface SiteFlags {
  /** The flags as YTM served them, before the overrides (empty until it has). */
  readonly served: Flags;
  /** The overrides in effect: performance mode's, then the user's. */
  readonly overrides: Flags;
}

/** The page config as far as the feature flags need it. */
const configData = (cfg: Ytcfg | undefined) => cfg?.data_ ?? cfg?.d?.() ?? {};

/** Applies `overrides` to the flags YTM's page sets up; call before its scripts run. */
export function overrideSiteFlags(overrides: Flags, performanceMode: boolean): SiteFlags {
  // The user's overrides stay mutable: the settings UI changes them live.
  const user: Flags = { ...overrides };
  const performance: Flags = performanceMode ? { ...performanceModeFeatureFlags } : {};
  const served: Flags = {};
  let current: Ytcfg | undefined;
  /** Set while re-notifying the page, whose payload is ours, not the page's. */
  let syncing = false;

  const merged = (): Flags => ({ ...performance, ...user });

  const flagsOf = (cfg: Ytcfg | undefined): Flags => {
    const data = configData(cfg);
    data.EXPERIMENT_FLAGS ??= {};
    return data.EXPERIMENT_FLAGS;
  };

  /** Keeps the values the page hands over: first value wins, so a later payload carrying ours is ignored. */
  const capture = (flags: Flags) => {
    for (const [name, value] of Object.entries(flags)) if (!(name in served)) served[name] = value;
  };

  const apply = (flags: Flags) => {
    capture(flags);
    Object.assign(flags, merged());
  };

  const patch = (cfg: Ytcfg) => {
    if (cfg.__pearFlags) return;
    const set = cfg.set?.bind(cfg);
    cfg.set = (...args: [key: string, value?: unknown]) => {
      const result = set?.(...args);
      // A later EXPERIMENT_FLAGS payload would otherwise drop the overrides.
      if (!syncing) {
        const [key, value] = args;
        if (args.length > 1 && key === "EXPERIMENT_FLAGS" && value && typeof value === "object") apply(value as Flags);
        else if (key && typeof key === "object") {
          const payload = key as unknown as Record<string, unknown>;
          if (payload.EXPERIMENT_FLAGS && typeof payload.EXPERIMENT_FLAGS === "object") apply(payload.EXPERIMENT_FLAGS as Flags);
        }
      }
      return result;
    };
    cfg.__pearFlags = true;
  };

  const adopt = (cfg: Ytcfg) => {
    patch(cfg);
    apply(flagsOf(cfg));
  };

  /** Re-apply, then tell the page's subscribers the flags changed. */
  const sync = () => {
    const cfg = current;
    if (!cfg) return;
    const flags = flagsOf(cfg);
    apply(flags);
    syncing = true;
    try {
      cfg.set?.("EXPERIMENT_FLAGS", flags);
    } finally {
      syncing = false;
    }
  };

  window.__pearFeatureFlags = {
    served: () => ({ ...served }),
    set: (name, value) => {
      user[name] = value;
      sync();
    },
    remove: (name) => {
      delete user[name];

      const cfg = current;
      if (!cfg) return;
      const flags = flagsOf(cfg);
      // A flag the page never had has no default to put back.
      if (Object.hasOwn(served, name)) flags[name] = served[name] as FlagValue;
      else delete flags[name];
      sync();
    },
    clientVersion: () => configData(current).INNERTUBE_CLIENT_VERSION,
  };

  // The page's `ytcfg = window.ytcfg || { ... }` lands here.
  const existing = window.ytcfg;
  let ytcfg: Ytcfg | undefined;
  Object.defineProperty(window, "ytcfg", {
    configurable: true,
    enumerable: true,
    get: () => ytcfg,
    set(value: Ytcfg) {
      ytcfg = value;
      current = value;
      adopt(value);
    },
  });
  // A config built before this ran (a reload, the dev server) is adopted as is.
  if (existing) window.ytcfg = existing;

  return { served, overrides: merged() };
}
