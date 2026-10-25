// Applying a config.json patch that did not come from the settings dialog: the
// API server's PATCH /pear/config and its MCP patch_config tool. Settings.patch
// only writes the file, so without this the patch is inert until a restart —
// plugin toggles would not start or stop, core options would not apply, and the
// settings UI would keep showing the old state. The settings dialog does the
// same work one field at a time in ipc.ts.

import { CORE_SECTIONS, type CoreSection } from "@pear/sdk/core-config";
import type { Settings } from "./config.ts";
import type { PluginHost } from "./plugins.ts";

/** A core section the settings dialog edits; the API server's own section rebinds itself. */
export type AppSection = Exclude<CoreSection, "apiServer">;
const APP_SECTIONS = (Object.keys(CORE_SECTIONS) as CoreSection[]).filter((section): section is AppSection => section !== "apiServer");

export interface ConfigApplyEnvironment {
  settings: Settings;
  plugins: PluginHost;
  /** Every defined plugin id, in definition order. */
  pluginIds: readonly string[];
  /** Applies one live core section and publishes its state to the UI. */
  applyCore(section: AppSection, previous: unknown, next: unknown): void;
  /** Rebinds or stops the API server after its own section changed. */
  applyApiServer(): Promise<void>;
}

/**
 * Merges `patch` into the stored config and applies what changed: core sections
 * live and plugins through the host (which starts, stops or restarts them).
 * Unknown keys stay in the file untouched, as with the settings dialog.
 */
export async function applyConfigPatch(env: ConfigApplyEnvironment, patch: Record<string, unknown>) {
  const coreBefore = structuredClone(env.settings.allCore());
  const pluginsBefore = new Map(env.pluginIds.map((id) => [id, structuredClone(env.settings.plugin(id))]));

  env.settings.patch(patch);

  for (const section of APP_SECTIONS) {
    const previous = coreBefore[section];
    const next = env.settings.core(section);
    if (JSON.stringify(previous) !== JSON.stringify(next)) env.applyCore(section, previous, next);
  }
  if (JSON.stringify(coreBefore.apiServer) !== JSON.stringify(env.settings.core("apiServer"))) await env.applyApiServer();

  for (const id of env.pluginIds) {
    const previous = pluginsBefore.get(id);
    const next = env.settings.plugin(id);
    if (!next) continue;
    if (next.enabled !== previous?.enabled) await env.plugins.setEnabled(id, next.enabled);
    // Only when the enabled flag did not change: setEnabled already starts the
    // part with the config the patch left in the file.
    else if (JSON.stringify(next.config) !== JSON.stringify(previous?.config)) await env.plugins.setConfig(id, next.config);
  }
}
