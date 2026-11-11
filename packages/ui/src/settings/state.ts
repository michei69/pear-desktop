// The dialog's shared state: the model, the open plugin cards, and the
// changes that wait for a restart.

import type { Field } from "@pear/sdk";
import type { CoreSection } from "@pear/sdk/core-config";
import type { PluginInfo, RestartRequirement } from "@pear/sdk/protocol";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { SettingsModel } from "../model.ts";
import { localize } from "../strings.ts";
import type { Localizer } from "./groups.ts";

export interface Dialog {
  readonly model: SettingsModel;
  readonly platform: string;
  /** By name. */
  readonly plugins: readonly PluginInfo[];
  /** The plugin cards that are open, by id: several can be. */
  readonly expanded: ReadonlySet<string>;
  toggleExpanded(id: string): void;
  collapse(): void;
  /** Fields with their texts in the active language, for "core" or a plugin id. */
  localizer(owner: string): Localizer;
  /** Changes a core option; false when the host refused it, so the control can reset itself. */
  setCore(section: CoreSection, key: string, field: Field, value: unknown): Promise<boolean>;
  setPluginConfig(plugin: PluginInfo, key: string, field: Field, value: unknown): void;
  setPluginEnabled(plugin: PluginInfo, enabled: boolean): void;
  readonly restarts: PendingRestarts;
}

export function useDialog(model: SettingsModel): Dialog {
  useModel(model);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const restarts = usePendingRestarts(model);
  const plugins = useMemo(() => [...model.plugins].sort((a, b) => a.name.localeCompare(b.name)), [model.plugins]);
  // The language only changes with a restart, so a localizer per owner stays valid for the dialog's life.
  const localizer = useMemo(
    () =>
      (owner: string): Localizer =>
      (key, field) =>
        localize(model.t, owner, key, field),
    [model],
  );
  return {
    model,
    platform: model.app.platform,
    plugins,
    expanded,
    toggleExpanded: (id) =>
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    collapse: () => setExpanded(new Set()),
    localizer,
    setCore(section, key, field, value) {
      const applied = model.setCoreConfig(section, { [key]: value });
      // Flagged as it is changed, before the write lands, like pear-desktop's session.
      if (field.restart) restarts.flag(`core:${section}.${key}`, field.label);
      return applied;
    },
    setPluginConfig(plugin, key, field, value) {
      void model.setConfig(plugin.id, { [key]: value });
      // A plugin's restart requirement is about the plugin, as pear-desktop's was.
      if (field.restart) restarts.flag(`plugin:${plugin.id}`, plugin.name);
    },
    setPluginEnabled(plugin, enabled) {
      void model.setEnabled(plugin.id, enabled);
      if (model.meta(plugin.id)?.restartRequired) restarts.flag(`plugin:${plugin.id}`, plugin.name);
    },
    restarts,
  };
}

const increment = (n: number) => n + 1;

/** A function that re-renders the component. */
function useRerender() {
  const [, setTick] = useState(0);
  return () => setTick(increment);
}

/** Re-renders whenever the model changes. */
function useModel(model: SettingsModel) {
  const rerender = useRerender();
  useEffect(() => model.subscribe(rerender), [model]);
}

export interface PendingRestarts {
  /** Changes wait for a restart and the banner wasn't dismissed. */
  readonly show: boolean;
  /** Notes a change that applies after a restart. */
  flag(key: string, label: string): void;
  dismiss(): void;
}

// Restart-pending changes outlive the dialog (closing and reopening it keeps the banner).
const pendingRestarts = new WeakMap<SettingsModel, Map<string, string>>();

/**
 * The banner's pending changes, plus the host's restart session: the host keeps
 * what each settings surface flagged (overlay and standalone window together) and
 * offers the restart once the last one closes.
 */
function usePendingRestarts(model: SettingsModel): PendingRestarts {
  const [dismissed, setDismissed] = useState(false);
  const rerender = useRerender();
  const pending = pendingRestarts.get(model) ?? new Map<string, string>();
  pendingRestarts.set(model, pending);
  // What this surface flagged, flushed when it closes: a window can be destroyed first.
  const flagged = useRef(new Map<string, string>());

  useEffect(() => {
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      void model.restartSessionClose([...flagged.current].map(([key, label]) => ({ key, label }))).catch(() => {});
    };
    void model.restartSessionOpen().catch(() => {});
    window.addEventListener("pagehide", close);
    return () => {
      window.removeEventListener("pagehide", close);
      close();
    };
  }, [model]);

  return {
    show: pending.size > 0 && !dismissed,
    flag(key, label) {
      if (flagged.current.has(key)) return;
      flagged.current.set(key, label);
      pending.set(key, label);
      // The host keeps the running list, so a window that dies before closing still reports it.
      void model.restartSessionAdd([{ key, label }]).catch(() => {});
      setDismissed(false);
      rerender();
    },
    dismiss: () => setDismissed(true),
  };
}
