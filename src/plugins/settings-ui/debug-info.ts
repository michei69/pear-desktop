import { createSignal, onCleanup } from 'solid-js';

import type { AppMeta } from './state';

const COPIED_FEEDBACK_MS = 1500;

const mb = (kilobytes: number) => `${Math.round(kilobytes / 1024)} MB`;

/** The text both copy actions produce, so a bug report carries the same environment either way. */
export const buildDebugInfo = (meta: AppMeta, plugins: string[]): string => {
  const { memory } = meta;
  const total = memory.main + memory.renderers + memory.gpu;

  const gpuFeatures = Object.entries(meta.gpu.features)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ');
  const driver = meta.gpu.driver ? ` (driver ${meta.gpu.driver})` : '';

  const lines = [
    `${meta.name} v${meta.version} (${meta.build})`,
    `Platform: ${meta.platform} (${meta.arch}), ${meta.osVersion}`,
    `Electron: ${meta.versions.electron} · Chromium: ${meta.versions.chrome} · Node: ${meta.versions.node}`,
    `CPU: ${meta.cpu.model} (${meta.cpu.threads} threads)`,
    `GPU: ${meta.gpu.renderer ?? meta.gpu.vendor ?? 'unknown'}${driver}`,
    `Memory: ${mb(total)} total (main ${mb(memory.main)}, renderers ${mb(memory.renderers)}, gpu ${mb(memory.gpu)})`,
  ];

  if (gpuFeatures) lines.push(`GPU features: ${gpuFeatures}`);
  if (plugins.length) {
    lines.push(`Plugins (${plugins.length}): ${plugins.join(', ')}`);
  }

  return lines.join('\n');
};

/** Clipboard copy with a short-lived flag, for the buttons that use it. */
export const useCopyFeedback = () => {
  const [copied, setCopied] = createSignal(false);
  let timer: number | undefined;
  onCleanup(() => clearTimeout(timer));

  // Deliberately not async: callers are click handlers with nothing to await.
  const copy = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        clearTimeout(timer);
        timer = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
      })
      .catch(() => {});
  };

  return { copied, copy };
};
