// Which plugins an enabled plugin keeps from running. Pure so the host and
// its tests share one policy: a plugin yields to the plugins it declares, and
// a mutual pair blocks the plugin that is off (or, when both were stored on,
// the one later in the catalog). A blocked plugin doesn't block others, so
// the answer is a fixed point over the enabled set.

import type { PluginConflict } from "@pear/sdk";

export interface ConflictPlugin {
  id: string;
  conflicts?: readonly PluginConflict[] | undefined;
}

interface MutualPair {
  a: string;
  b: string;
  reason: string;
}

type Blocked = Map<string, { id: string; reason: string }>;

/** The blocker for each plugin that must show as disabled, by blocked plugin id. */
export function resolvePluginConflicts(plugins: readonly ConflictPlugin[], enabled: ReadonlySet<string>): Blocked {
  const order = new Map(plugins.map((plugin, index) => [plugin.id, index]));
  const pairs = collectPairs(plugins);
  const stored = new Set([...enabled].filter((id) => order.has(id)));

  let blocked: Blocked = new Map();
  let active = new Set(stored);
  for (let pass = 0; pass <= plugins.length; pass++) {
    const next = resolvePass(plugins, stored, active, pairs, order);
    const stable = next.size === blocked.size && [...next].every(([id, b]) => blocked.get(id)?.id === b.id);
    blocked = next;
    active = new Set([...stored].filter((id) => !blocked.has(id)));
    if (stable) break;
  }
  return blocked;
}

function collectPairs(plugins: readonly ConflictPlugin[]): MutualPair[] {
  const pairs = new Map<string, MutualPair>();
  for (const plugin of plugins) {
    for (const conflict of plugin.conflicts ?? []) {
      if (!conflict.mutual || plugin.id === conflict.id) continue;
      const key = [plugin.id, conflict.id].sort().join("\0");
      if (!pairs.has(key)) pairs.set(key, { a: plugin.id, b: conflict.id, reason: conflict.reason });
    }
  }
  return [...pairs.values()];
}

function resolvePass(
  plugins: readonly ConflictPlugin[],
  stored: ReadonlySet<string>,
  active: ReadonlySet<string>,
  pairs: readonly MutualPair[],
  order: ReadonlyMap<string, number>,
): Blocked {
  const blocked: Blocked = new Map();
  const block = (id: string, blocker: string, reason: string) => {
    const current = blocked.get(id);
    if (current && (order.get(current.id) ?? 0) <= (order.get(blocker) ?? 0)) return;
    blocked.set(id, { id: blocker, reason });
  };

  // A directional declaration means "I yield when the other runs". The other
  // must be actually running (not itself blocked), and the yield is shown in
  // settings whether or not this plugin is currently on.
  for (const plugin of plugins) {
    for (const conflict of plugin.conflicts ?? []) {
      if (!conflict.mutual && active.has(conflict.id)) block(plugin.id, conflict.id, conflict.reason);
    }
  }

  for (const pair of pairs) {
    const aOn = active.has(pair.a);
    const bOn = active.has(pair.b);
    if (aOn && bOn) {
      const [winner, loser] = (order.get(pair.a) ?? 0) <= (order.get(pair.b) ?? 0) ? [pair.a, pair.b] : [pair.b, pair.a];
      block(loser, winner, pair.reason);
    } else if (aOn) {
      block(pair.b, pair.a, pair.reason);
    } else if (bOn) {
      block(pair.a, pair.b, pair.reason);
    }
  }

  // Keep only entries that matter: a stored-on plugin is blocked, or a
  // stored-off plugin gets a tooltip because an active plugin owns the slot.
  for (const id of blocked.keys()) {
    if (!stored.has(id) && !active.size) blocked.delete(id);
  }
  return blocked;
}
