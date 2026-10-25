// The About section: the app's identity, versions, links and actions, with the
// update settings drawn under the actions. Ported from pear-desktop's.

import type { ComponentChildren } from "preact";
import { Icon, PearIcon, YtmIcon } from "../icons.tsx";
import type { SettingsModel } from "../model.ts";
import { useText } from "../strings.ts";
import { buildDebugInfo, storedFlagOverrides, useCopyFeedback } from "./debug-info.ts";
import { liveFeatureFlags } from "./live-flags.ts";

const REPO = "https://github.com/michei69/pear-desktop";

const osOptionLabel = (platform: string) => {
  if (platform === "win32") return "Windows";
  if (platform === "darwin") return "macOS";
  if (platform === "linux") return "Other Linux";
  return "Other (specify below)";
};
const archOptionLabel = (arch: string) => {
  if (arch === "x64") return "x64";
  if (arch === "ia32") return "ia32";
  if (arch === "arm64") return "arm64 (including Apple Silicon)";
  return "Other (specify below)";
};

export function About({ model, enabled, children }: { model: SettingsModel; enabled: string[]; children?: ComponentChildren }) {
  const app = model.app;
  const text = useText();
  // The same artwork the app registers with the OS.
  const useYtmIcons = model.core("appearance")?.config.useYtmIcons === true;
  const { copied, copy } = useCopyFeedback();

  const versionRows = () => [
    { label: text("settings-ui.about.version-app"), value: `v${app.version}` },
    { label: text("settings-ui.about.version-build"), value: app.build ?? "…" },
    { label: text("settings-ui.about.version-electron"), value: app.electron },
    { label: text("settings-ui.about.version-chromium"), value: app.chrome },
    { label: text("settings-ui.about.version-node"), value: app.node },
    { label: text("settings-ui.about.version-platform"), value: `${app.platform} (${app.arch})` },
    { label: text("settings-ui.about.version-innertube"), value: liveFeatureFlags()?.clientVersion() ?? "unknown" },
  ];

  const reportIssueUrl = () => {
    const params = new URLSearchParams({ template: "bug_report.yml" });
    params.set("app-version", app.version);
    params.set("os", osOptionLabel(app.platform));
    params.set("cpu-arch", archOptionLabel(app.arch));
    if (enabled.length) {
      params.set("enabled-plugins", enabled.map((name, index) => `${index + 1}. ${name}`).join("\n"));
    }
    return `${REPO}/issues/new?${params.toString()}`;
  };

  const links = () => [
    { icon: "github" as const, label: text("settings-ui.about.link-repo"), url: REPO },
    { icon: "external" as const, label: text("settings-ui.about.link-issue"), url: reportIssueUrl() },
    { icon: "external" as const, label: text("settings-ui.about.link-releases"), url: `${REPO}/releases` },
    { icon: "external" as const, label: text("settings-ui.about.link-license"), url: `${REPO}/blob/master/license` },
  ];

  const copyDebugInfo = async () => {
    try {
      const meta = await model.appMeta();
      const live = model.siteFlags?.();
      const performanceMode = model.core("advanced")?.config.performanceMode === true;
      copy(buildDebugInfo(meta, enabled, live?.served ?? {}, live?.overrides ?? storedFlagOverrides(model), performanceMode));
    } catch (error) {
      console.error("[pear] reading the debug info failed", error);
    }
  };

  return (
    <div class="about">
      <div class="about-header">
        {useYtmIcons ? <YtmIcon size={88} /> : <PearIcon size={88} />}
        <div class="about-name">Pear Desktop</div>
        <div class="about-version">{`v${app.version}${app.build ? ` ${app.build}` : ""}`}</div>
        <div class="about-tagline">{text("settings-ui.about.tagline")}</div>
      </div>

      <div class="card about-card">
        <div class="about-section-title">{text("settings-ui.about.versions")}</div>
        <dl class="about-grid">
          {versionRows().map((row) => (
            <div class="about-grid-row" key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div class="card about-card">
        <div class="about-section-title">{text("settings-ui.about.links")}</div>
        <div class="about-links">
          {links().map((link) => (
            <button key={link.label} type="button" class="outlined about-link" onClick={() => void model.openExternal(link.url)}>
              <Icon name={link.icon} size={18} />
              <span>{link.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div class="card about-card">
        <div class="about-section-title">{text("settings-ui.about.actions")}</div>
        <div class="actions">
          <button
            type="button"
            class="outlined"
            onClick={() => {
              model.checkUpdates().catch(() => {});
            }}
          >
            {text("settings-ui.about.check-updates")}
          </button>
          <button type="button" class="outlined" onClick={() => void copyDebugInfo()}>
            {copied ? text("settings-ui.about.copied") : text("settings-ui.about.copy-debug")}
          </button>
        </div>
      </div>

      {children}

      {app.copyright && <div class="about-copyright">{app.copyright}</div>}
    </div>
  );
}
