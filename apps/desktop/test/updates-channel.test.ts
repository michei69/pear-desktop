// Channel parity, ported from pear-desktop's update-channel tests: the flags
// `applyChannel` sets must mean what electron-updater's GitHub provider says,
// and a beta build starts on the beta channel until the user picks one.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppUpdater } from "electron-updater";
import { GitHubProvider } from "electron-updater/out/providers/GitHubProvider.js";
import { afterEach, expect, test, vi } from "vitest";
import { channelFlags, feedOptions, type UpdateChannel } from "../src/main/updates.ts";

vi.mock("electron", () => ({}));

/** A GitHub release feed with the beta tag first, as a rolling beta would be. */
const ATOM_FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Pear Desktop 3.12.4-beta.1</title>
    <link rel="alternate" type="text/html" href="https://github.com/michei69/pear-desktop/releases/tag/v3.12.4-beta.1"/>
    <content type="html">beta notes</content>
  </entry>
  <entry>
    <title>Pear Desktop 3.12.3</title>
    <link rel="alternate" type="text/html" href="https://github.com/michei69/pear-desktop/releases/tag/v3.12.3"/>
    <content type="html">stable notes</content>
  </entry>
</feed>`;

const channelFile = (version: string) => `version: ${version}\nfiles: []\npath: pear-${version}.AppImage\nsha512: zzz\n`;

/** Runs the real GitHub provider against a stub executor with the flags the app sets. */
async function runProvider(
  channel: UpdateChannel,
  { missingBetaFile = false, platform = "linux", feed = ATOM_FEED, currentVersion = "3.12.3" } = {},
) {
  const requests: string[] = [];
  const executor = {
    request: async (options: { path: string }) => {
      requests.push(options.path);
      if (options.path.endsWith(".atom")) return feed;
      if (options.path.endsWith("/releases/latest")) return JSON.stringify({ tag_name: "v3.12.3" });
      if (/beta(-linux|-mac)?\.yml$/.test(options.path)) {
        if (missingBetaFile) throw new Error(`404 ${options.path}`);
        // The rolling beta rebuilds its release in place: the file carries its tag's version.
        const tag = /\/download\/v([^/]+)\//.exec(options.path)?.[1] ?? "3.12.4-beta.1";
        return channelFile(tag);
      }
      if (/latest(-linux|-mac)?\.yml$/.test(options.path)) return channelFile("3.12.3");
      throw new Error(`unexpected request: ${options.path}`);
    },
  };
  const runtime = { platform, executor } as unknown as ConstructorParameters<typeof GitHubProvider>[2];
  const provider = new GitHubProvider(feedOptions(channel), { ...channelFlags(channel), currentVersion } as unknown as AppUpdater, runtime);
  return { requests, info: await provider.getLatestVersion() };
}

test("stable cannot return a prerelease", async () => {
  const { requests, info } = await runProvider("stable");

  // It asks GitHub for /releases/latest, which never points at a prerelease...
  expect(requests.some((path) => path.endsWith("/releases/latest"))).toBe(true);
  // ...and reads the stable channel file, even with the beta tag first in the feed.
  expect(requests.at(-1)).toBe("/michei69/pear-desktop/releases/download/v3.12.3/latest-linux.yml");
  expect(info.tag).toBe("v3.12.3");
  expect(info.version).toBe("3.12.3");
});

test("the beta channel reads beta.yml from the beta tag", async () => {
  const { requests, info } = await runProvider("beta");

  expect(requests.at(-1)).toBe("/michei69/pear-desktop/releases/download/v3.12.4-beta.1/beta-linux.yml");
  expect(info.tag).toBe("v3.12.4-beta.1");
  expect(info.version).toBe("3.12.4-beta.1");
});

test("the platform decides the channel file suffix", async () => {
  expect((await runProvider("beta", { platform: "win32" })).requests.at(-1)).toBe(
    "/michei69/pear-desktop/releases/download/v3.12.4-beta.1/beta.yml",
  );
  expect((await runProvider("beta", { platform: "darwin" })).requests.at(-1)).toBe(
    "/michei69/pear-desktop/releases/download/v3.12.4-beta.1/beta-mac.yml",
  );
});

test("a beta feed without beta.yml falls back to an older release, so the download reports a failure", async () => {
  // Upstream's provider retries the default channel file when beta.yml is
  // missing, which resolves to the running version. The download flow treats
  // "no newer release" as a failed download and offers the release page.
  const { requests, info } = await runProvider("beta", { missingBetaFile: true });
  expect(requests.at(-1)).toBe("/michei69/pear-desktop/releases/download/v3.12.4-beta.1/latest-linux.yml");
  expect(info.version).toBe("3.12.3");
});

test("a beta user picks up the next beta from the rolling release", async () => {
  const nextBeta = "3.12.4-beta.42";
  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <link href="https://github.com/michei69/pear-desktop/releases/tag/v${nextBeta}"/>
    <title>Pear Desktop ${nextBeta} (beta)</title>
  </entry>
  <entry>
    <link href="https://github.com/michei69/pear-desktop/releases/tag/v3.12.3"/>
    <title>v3.12.3</title>
  </entry>
</feed>`;
  const { info } = await runProvider("beta", { feed, currentVersion: "3.12.4-beta.41" });
  expect(info.tag).toBe(`v${nextBeta}`);
  expect(info.version).toBe(nextBeta);
});

/** The channel a beta build starts on is pear-desktop's 3.12.4 migration's job here. */
const tempStore = () => mkdtempSync(join(tmpdir(), "pear-update-channel-"));
const useBetaBuild = () => {
  vi.resetModules();
  vi.doMock("../src/main/app-info.ts", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/main/app-info.ts")>()),
    defaultUpdateChannel: () => "beta",
  }));
};

const openSettings = async (cwd: string) => {
  const { Settings } = await import("../src/main/config.ts");
  return new Settings(cwd, [], "4.0.0");
};

afterEach(() => {
  vi.doUnmock("../src/main/app-info.ts");
  vi.resetModules();
});

test("a fresh beta build starts on the beta channel", async () => {
  useBetaBuild();
  const cwd = tempStore();
  try {
    const settings = await openSettings(cwd);
    expect(settings.core("general").updateChannel).toBe("beta");
    settings.flush();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a fresh stable build starts on the stable channel", async () => {
  const cwd = tempStore();
  try {
    const settings = await openSettings(cwd);
    expect(settings.core("general").updateChannel).toBe("stable");
    settings.flush();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a channel the user already chose survives the beta seed", async () => {
  useBetaBuild();
  const cwd = tempStore();
  try {
    writeFileSync(join(cwd, "config.json"), JSON.stringify({ options: { updateChannel: "stable" } }));
    const settings = await openSettings(cwd);
    expect(settings.core("general").updateChannel).toBe("stable");
    settings.flush();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
