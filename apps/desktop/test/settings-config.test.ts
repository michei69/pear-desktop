// The core config's schema details the settings dialog relies on: the restart
// markers, the restart-on-change option, and the stored feature-flag format that
// carries JSON values (objects, arrays, null) through "name=value" entries.

import { readFileSync } from "node:fs";
import type { Field } from "@pear/sdk";
import { CORE_FIELD_KEYS, CORE_SECTIONS, flagOverrides, parseFlagOverride, withFlagOverride } from "@pear/sdk/core-config";
import { translator } from "@pear/sdk/i18n";
import { describe, expect, test } from "vitest";
import { localize, UI_STRINGS } from "../../../packages/ui/src/strings.ts";

const EN = JSON.parse(readFileSync(new URL("../../../src/i18n/resources/en.json", import.meta.url), "utf8")) as Record<string, unknown>;

/** A dotted key's value in a translation file. */
const lookup = (key: string) =>
  key
    .split(".")
    .reduce<unknown>((node, part) => (typeof node === "object" && node !== null ? (node as Record<string, unknown>)[part] : undefined), EN);

describe("core config schema", () => {
  test("the restart-on-change option lives with the other advanced options", () => {
    expect(CORE_SECTIONS.advanced.restartOnConfigChanges).toMatchObject({ kind: "bool", default: false });
    expect(CORE_SECTIONS.advanced.restartOnConfigChanges.group).toBe("Configuration");
  });

  test("every translation override names a real field and an existing key", () => {
    const fields = new Set(Object.values(CORE_SECTIONS).flatMap((shape) => Object.keys(shape)));
    for (const [name, keys] of Object.entries(CORE_FIELD_KEYS)) {
      expect(fields, `CORE_FIELD_KEYS.${name}`).toContain(name);
      const used = [
        keys.label,
        keys.description,
        keys.placeholder,
        ...Object.values(keys.options ?? {}),
        ...Object.values(keys.vars ?? {}),
      ];
      for (const key of used) if (key) expect(lookup(key), key).toBeTypeOf("string");
    }
  });

  test("options only read at startup ask for a restart", () => {
    for (const field of [
      CORE_SECTIONS.general.resumeOnStart,
      CORE_SECTIONS.general.startingPage,
      CORE_SECTIONS.advanced.autoResetAppCache,
    ]) {
      expect(field.restart).toBe(true);
    }
    // These apply live (the page and the window listen for core-state).
    expect(CORE_SECTIONS.window.alwaysOnTop.restart).toBeUndefined();
    expect(CORE_SECTIONS.appearance.useYtmIcons.restart).toBeUndefined();
  });
});

describe("feature flag override values", () => {
  test("scalars keep the plain format", () => {
    expect(withFlagOverride([], "a_flag", true)).toEqual(["a_flag=true"]);
    expect(withFlagOverride([], "a_rate", 0.25)).toEqual(["a_rate=0.25"]);
    expect(withFlagOverride([], "a_text", "hello")).toEqual(["a_text=hello"]);
    expect(withFlagOverride([], "a_blank", "")).toEqual(["a_blank="]);
  });

  test("text that would read back as another type is JSON-quoted", () => {
    for (const text of ["true", "false", "42", "0.5", "1e3", " null ", "json:x"]) {
      const [entry] = withFlagOverride([], "flag", text);
      expect(parseFlagOverride(entry!), `${JSON.stringify(text)} round-trips`).toEqual(["flag", text]);
    }
  });

  test("objects, arrays and null survive the round trip", () => {
    for (const value of [{ a: 1, b: [true, "x"] }, [1, 2, 3], null]) {
      const entries = withFlagOverride([], "flag", value);
      expect(flagOverrides(entries)).toEqual({ flag: value });
    }
  });

  test("pear-desktop's migrated JSON text is read back typed", () => {
    // siteFlagEntries() in the migrations writes objects and arrays as their JSON text, unprefixed.
    expect(parseFlagOverride('flag={"a":1}')).toEqual(["flag", { a: 1 }]);
    expect(parseFlagOverride("flag=[1,2]")).toEqual(["flag", [1, 2]]);
  });

  test("malformed JSON stays text instead of breaking the list", () => {
    expect(parseFlagOverride("flag=json:{bad")).toEqual(["flag", "json:{bad"]);
    expect(parseFlagOverride("flag={bad")).toEqual(["flag", "{bad"]);
  });

  test("setting a flag replaces its entry, keeping the others", () => {
    expect(withFlagOverride(["a=1", "b=true"], "a", { n: 2 })).toEqual(["b=true", 'a=json:{"n":2}']);
  });
});

describe("core field texts", () => {
  test("fields pear-desktop translated use its keys", () => {
    const t = translator({
      "main.menu.options.submenu.advanced-options.submenu.disable-hardware-acceleration": "Hardware-Beschleunigung deaktivieren",
      "main.menu.options.submenu.advanced-options.submenu.auto-reset-app-cache": "Anwendungscache beim Start der Anwendung zurücksetzen",
      "settings-ui.fields.context-menu.hide-entry": "{{entry}} ausblenden",
      "settings-ui.fields.context-menu.entries.download": "Herunterladen",
    });
    expect(localize(t, "core", "disableHardwareAcceleration", CORE_SECTIONS.advanced.disableHardwareAcceleration).label).toBe(
      "Hardware-Beschleunigung deaktivieren",
    );
    const download = localize(t, "core", "contextMenuDownload", (CORE_SECTIONS.appearance as Record<string, Field>).contextMenuDownload!);
    expect(download.label).toBe("Herunterladen ausblenden");
  });

  test("its own texts (and the English fallbacks) still come from the generated keys", () => {
    const t = translator({ "settings-ui.core.flags.label": "Leichtgewichtige Oberfläche" });
    expect(localize(t, "core", "flags", CORE_SECTIONS.performance.flags).label).toBe("Leichtgewichtige Oberfläche");
    // A field pear-desktop translated reads its own key (from the schema's map).
    const master = translator({
      "main.menu.options.submenu.advanced-options.submenu.auto-reset-app-cache": "Anwendungscache beim Start der Anwendung zurücksetzen",
    });
    expect(localize(master, "core", "autoResetAppCache", CORE_SECTIONS.advanced.autoResetAppCache).label).toBe(
      "Anwendungscache beim Start der Anwendung zurücksetzen",
    );
    // False without a translation: the English text next to the schema.
    expect(localize(t, "core", "appVisible", CORE_SECTIONS.window.appVisible).label).toBe(CORE_SECTIONS.window.appVisible.label);
  });

  test("the boot-failure card has its texts", () => {
    expect(UI_STRINGS["settings-ui.boot-failed.title"]).toBeTruthy();
    expect(UI_STRINGS["settings-ui.boot-failed.message"]).toContain("{{error}}");
    expect(UI_STRINGS["settings-ui.boot-failed.reload"]).toBeTruthy();
  });
});
