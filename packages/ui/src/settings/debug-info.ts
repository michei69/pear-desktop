// The text both Copy debug info actions produce: app, machine, plugins and
// feature flags, the same environment pear-desktop's report carried.

import { flagOverrides, type Flags } from "@pear/sdk/core-config";
import type { AppDebugInfo } from "@pear/sdk/protocol";
import { useEffect, useRef, useState } from "preact/hooks";
import type { SettingsModel } from "../model.ts";
import { liveFeatureFlags } from "./live-flags.ts";

/** The overrides saved in the config, for the standalone window where the page isn't there to ask. */
export const storedFlagOverrides = (model: SettingsModel): Flags => {
  const list = model.core("site")?.config.siteFlags;
  return flagOverrides(Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === "string") : []);
};

const COPIED_MS = 1500;

const mb = (kilobytes: number) => `${Math.round(kilobytes / 1024)} MB`;

/** Every flag the page carries plus the ones the user added, sorted so two reports line up. */
const flagLines = (served: Flags, overrides: Flags): string[] =>
  [...new Set([...Object.keys(served), ...Object.keys(overrides)])]
    .sort((a, b) => a.localeCompare(b))
    .map(
      (name) => `${name}: ${JSON.stringify(name in served ? served[name] : overrides[name])}${name in overrides ? " (overridden)" : ""}`,
    );

/** The copied report: the app's version, the machine, the plugins and the page's flags. */
export function buildDebugInfo(meta: AppDebugInfo, plugins: string[], served: Flags, overrides: Flags, performanceMode = false): string {
  const { memory } = meta;
  const total = memory.main + memory.renderers + memory.gpu;

  const gpuFeatures = Object.entries(meta.gpu.features)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");
  const driver = meta.gpu.driver ? ` (driver ${meta.gpu.driver})` : "";

  const lines = [
    `${meta.name} v${meta.version} (${meta.build})`,
    `Platform: ${meta.platform} (${meta.arch}), ${meta.osVersion}`,
    `Electron: ${meta.versions.electron} · Chromium: ${meta.versions.chrome} · Node: ${meta.versions.node}`,
    `Innertube client version: ${liveFeatureFlags()?.clientVersion() ?? "unknown"}`,
    `Performance mode: ${performanceMode ? "on" : "off"}`,
    `CPU: ${meta.cpu.model} (${meta.cpu.threads} threads)`,
    `GPU: ${meta.gpu.renderer ?? meta.gpu.vendor ?? "unknown"}${driver}`,
    `Memory: ${mb(total)} total (main ${mb(memory.main)}, renderers ${mb(memory.renderers)}, gpu ${mb(memory.gpu)})`,
  ];

  if (gpuFeatures) lines.push(`GPU features: ${gpuFeatures}`);
  if (plugins.length) lines.push(`Plugins (${plugins.length}): ${plugins.join(", ")}`);

  const flags = flagLines(served, overrides);
  if (flags.length) {
    const count = Object.keys(overrides).length;
    lines.push(`Feature flags (${flags.length}${count ? `, ${count} overridden` : ""}):`, ...flags);
  }

  return lines.join("\n");
}

/** Clipboard copy with a short-lived flag, for the buttons that use it. */
export function useCopyFeedback() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Deliberately not async: callers are click handlers with nothing to await.
  const copy = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), COPIED_MS);
      })
      .catch(() => {});
  };

  return { copied, copy };
}
