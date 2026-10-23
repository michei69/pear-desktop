import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Settings, ThemeSettings } from "../src/main/config.ts";
import { hashThemeJs, isJsConsented, readThemesFrom } from "../src/main/theme-load.ts";
import { Themes } from "../src/main/themes.ts";

// The engine reads the profile path and asks for consent; both stay in the test.
const electron = vi.hoisted(() => ({ userData: "", messageResponse: 1 }));
vi.mock("electron", () => ({
  app: { getPath: () => electron.userData },
  dialog: {
    showMessageBox: async () => ({ response: electron.messageResponse }),
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  },
  shell: { openPath: async () => "" },
}));
vi.mock("../src/main/basic-theme.css?inline", () => ({ default: "basic {}" }));

/** A Settings stand-in holding only the theme keys the engine touches. */
function fakeSettings(initial: Partial<ThemeSettings> = {}, legacy: string[] = []) {
  let config: ThemeSettings = {
    theme: "",
    themePresets: {},
    themeOverrides: {},
    themeConsent: {},
    themesSeeded: true,
    ...initial,
  };
  let legacyCss = legacy;
  const settings = {
    themeConfig: () => config,
    setThemeConfig: (patch: Partial<ThemeSettings>) => {
      config = { ...config, ...patch };
    },
    legacyThemeCss: () => legacyCss,
    clearLegacyThemeCss: () => {
      legacyCss = [];
    },
  };
  return { settings: settings as unknown as Settings, config: () => config, legacy: () => legacyCss };
}

const dirs: string[] = [];
const engines: Themes[] = [];
const profile = () => {
  const dir = mkdtempSync(join(tmpdir(), "pear-themes-"));
  electron.userData = dir;
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const engine of engines.splice(0)) engine.stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeTheme(dir: string, id: string, manifest: Record<string, unknown>, files: Record<string, string> = {}) {
  const folder = join(dir, "themes", id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "theme.json"), JSON.stringify(manifest));
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(folder, name), contents);
  return folder;
}

function engine(settings: Settings, t = (key: string, fallback?: string) => fallback ?? key) {
  const onChange = vi.fn();
  const onCatalogChange = vi.fn();
  const instance = new Themes(settings, t, onChange, onCatalogChange);
  engines.push(instance);
  return { instance, onChange, onCatalogChange };
}

describe("theme folders", () => {
  test("reads the manifest, concatenates its CSS and hashes the script", () => {
    const dir = profile();
    writeTheme(
      dir,
      "sunset",
      { name: "Sunset", palette: { accent: "#f00" }, css: ["a.css", "b.css"], js: "theme.js" },
      { "a.css": "a {}", "b.css": "b {}", "theme.js": "module.exports = {};" },
    );
    writeTheme(dir, "broken", { css: 42 });
    mkdirSync(join(dir, "themes", "not-a-theme"), { recursive: true });

    const [theme] = readThemesFrom(join(dir, "themes"));
    expect(theme).toMatchObject({ id: "sunset", name: "Sunset", css: "a {}\nb {}", palette: { accent: "#f00" } });
    expect(theme?.js?.hash).toBe(hashThemeJs("module.exports = {};"));
    expect(readThemesFrom(join(dir, "themes"))).toHaveLength(1);
    // Consent is pinned to the exact source.
    expect(isJsConsented(theme!, {})).toBe(false);
    expect(isJsConsented(theme!, { sunset: theme!.js!.hash })).toBe(true);
    expect(isJsConsented({ id: "plain" }, {})).toBe(true);
  });
});

describe("Themes", () => {
  test("seeds the Basic theme on a fresh profile", () => {
    const dir = profile();
    const { settings, config } = fakeSettings({ themesSeeded: false });
    const { instance } = engine(settings);
    instance.start();

    expect(instance.all.map((theme) => theme.id)).toEqual(["basic"]);
    expect(config().themesSeeded).toBe(true);
    expect(existsSync(join(dir, "themes", "basic", "style.css"))).toBe(true);
    expect(instance.state().themes[0]?.name).toBe("Basic");
  });

  test("migrates the legacy CSS list once, without changing an existing selection", () => {
    const dir = profile();
    const legacyDir = mkdtempSync(join(tmpdir(), "pear-legacy-theme-"));
    dirs.push(legacyDir);
    const first = join(legacyDir, "old-theme.css");
    const second = join(legacyDir, "more.css");
    writeFileSync(first, "first {}");
    writeFileSync(second, "second {}");
    writeTheme(dir, "other", { name: "Other", css: "style.css" }, { "style.css": "other {}" });

    const { settings, config, legacy } = fakeSettings({ theme: "other" }, [first, second]);
    const { instance } = engine(settings);
    instance.start();

    expect(config().theme).toBe("other");
    expect(legacy()).toEqual([]);
    const folder = join(dir, "themes", "old-theme");
    expect(existsSync(join(folder, "theme.json"))).toBe(true);
    expect(readFileSync(join(folder, "1-old-theme.css"), "utf8")).toBe("first {}");
    expect(readFileSync(join(folder, "2-more.css"), "utf8")).toBe("second {}");
    expect(instance.all.map((theme) => theme.id)).toEqual(["old-theme", "other"]);
  });

  test("selects a migrated theme when nothing was selected", () => {
    const dir = profile();
    const legacyDir = mkdtempSync(join(tmpdir(), "pear-legacy-theme-"));
    dirs.push(legacyDir);
    const css = join(legacyDir, "my-theme.css");
    writeFileSync(css, "css {}");

    const { settings, config } = fakeSettings({}, [css]);
    const { instance } = engine(settings);
    instance.start();

    expect(config().theme).toBe("my-theme");
    expect(instance.state().selected).toBe("my-theme");
    expect(instance.state().themes[0]?.css).toBe("css {}");
  });

  test("selects, picks presets and edits the palette; a deleted theme is pruned", async () => {
    const dir = profile();
    writeTheme(
      dir,
      "sunset",
      { name: "Sunset", palette: { accent: "#f00" }, presets: { night: { accent: "#000" } }, css: "style.css" },
      { "style.css": "sunset {}" },
    );
    const { settings, config } = fakeSettings();
    const { instance, onChange } = engine(settings);
    instance.start();

    expect(await instance.select("sunset")).toBe(true);
    expect(config().theme).toBe("sunset");
    expect(instance.state()).toMatchObject({ selected: "sunset", overrides: { sunset: {} } });

    instance.setPreset("sunset", "night");
    expect(instance.state()).toMatchObject({ presets: { sunset: "night" }, overrides: { sunset: { accent: "#000" } } });

    instance.setPaletteValue("sunset", "accent", "#abc");
    expect(config().themePresets.sunset).toBe("custom");
    expect(instance.state().overrides.sunset).toEqual({ accent: "#abc" });

    instance.resetPalette("sunset");
    expect(config().themePresets.sunset).toBe("");
    expect(config().themeOverrides.sunset).toBeUndefined();
    expect(instance.state().overrides.sunset).toEqual({});

    rmSync(join(dir, "themes", "sunset"), { recursive: true, force: true });
    await vi.waitFor(() => expect(config().theme).toBe(""), { timeout: 5000, interval: 100 });
    expect(instance.all).toEqual([]);
    expect(onChange).toHaveBeenCalled();
  });

  test("runs a script only after consent and withholds it when the user declines", async () => {
    const dir = profile();
    writeTheme(dir, "trusted", { css: "style.css", js: "theme.js" }, { "style.css": "a {}", "theme.js": "module.exports = {};" });
    writeTheme(dir, "untrusted", { css: "style.css", js: "theme.js" }, { "style.css": "b {}", "theme.js": "module.exports = {};" });

    const { settings, config } = fakeSettings();
    const { instance } = engine(settings);
    instance.start();

    // The page never sees an unconsented script.
    expect(instance.state().themes.find((theme) => theme.id === "trusted")?.js).toBeUndefined();
    expect(instance.state().themes.find((theme) => theme.id === "trusted")?.jsBlocked).toBe(true);

    electron.messageResponse = 1;
    expect(await instance.select("untrusted")).toBe(false);
    expect(config().theme).toBe("");
    expect(config().themeConsent).toEqual({});

    electron.messageResponse = 0;
    expect(await instance.select("trusted")).toBe(true);
    const hash = hashThemeJs("module.exports = {};");
    expect(config().themeConsent.trusted).toBe(hash);
    expect(instance.state().themes.find((theme) => theme.id === "trusted")?.js?.hash).toBe(hash);

    // A changed script is no longer the consented one.
    writeFileSync(join(dir, "themes", "trusted", "theme.js"), "module.exports = { mount() {} };");
    await vi.waitFor(() => expect(instance.state().themes.find((theme) => theme.id === "trusted")?.jsBlocked).toBe(true), {
      timeout: 5000,
      interval: 100,
    });
  });

  test("creates a theme folder from CSS files", async () => {
    const dir = profile();
    const cssDir = mkdtempSync(join(tmpdir(), "pear-import-"));
    dirs.push(cssDir);
    const css = join(cssDir, "imported.css");
    writeFileSync(css, "imported {}");

    const { settings, config } = fakeSettings();
    const { instance, onCatalogChange } = engine(settings);
    instance.start();

    const id = await instance.import([css]);
    expect(id).toBe("imported");
    expect(config().theme).toBe("imported");
    expect(instance.state().themes[0]?.css).toBe("imported {}");
    expect(onCatalogChange).toHaveBeenCalled();
    expect(existsSync(join(dir, "themes", "imported", "style.css"))).toBe(true);
  });
});
