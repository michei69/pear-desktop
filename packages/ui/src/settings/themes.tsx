// The Theme card: pick a folder theme, its preset, edit the palette, and import
// CSS files or open the themes folder. The host watches those folders, so edits
// made there show up without a restart.

import { CUSTOM_PRESET, defaultPreset, keyLabel, resolvePalette, type ThemePalette } from "@pear/sdk/themes";
import { useEffect, useState } from "preact/hooks";
import type { SettingsModel } from "../model.ts";
import { useText } from "../strings.ts";
import type { Dialog } from "./state.ts";

export function ThemeCard({ dialog }: { dialog: Dialog }) {
  const { model } = dialog;
  const text = useText();
  const state = model.themes();
  const selected = state.themes.find((theme) => theme.id === state.selected);
  const pick = selected ? (defaultPreset(selected.palette, selected.presets, state.presets[selected.id]) ?? "") : "";
  const palette = resolvePalette(selected?.palette, (selected && state.overrides[selected.id]) || {});
  const presetNames = Object.keys(selected?.presets ?? {});
  const [failed, setFailed] = useState("");

  const choose = (id: string) => {
    setFailed("");
    void model.selectTheme(id).then((allowed) => {
      if (!allowed) setFailed(text("settings-ui.themes.declined"));
    });
  };

  return (
    <div class="group">
      <div class="group-title">{text("main.menu.options.submenu.visual-tweaks.submenu.theme.label")}</div>
      <div class="card">
        <div class="field">
          <div class="field-text">
            <div class="label-line">
              <label class="field-label" for="field-theme" id="field-theme-label">
                {text("main.menu.options.submenu.visual-tweaks.submenu.theme.label")}
              </label>
              {selected?.author && <span class="pill">{text("settings-ui.themes.author", { author: selected.author })}</span>}
            </div>
            <div class="field-desc">{selected?.description ?? text("settings-ui.themes.description")}</div>
          </div>
          <div class="field-control">
            <select id="field-theme" class="dropdown" value={state.selected} onChange={(e) => choose(e.currentTarget.value)}>
              <option value="">{text("main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.no-theme")}</option>
              {state.themes.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {state.themes.length === 0 && <p class="theme-note">{text("settings-ui.themes.empty")}</p>}

        {selected && selected.jsBlocked && (
          <div class="field">
            <div class="field-desc">{text("settings-ui.themes.js-blocked")}</div>
            <div class="field-control">
              <button
                type="button"
                class="outlined"
                onClick={() =>
                  void model.allowThemeScript(selected.id).then((allowed) => {
                    if (!allowed) setFailed(text("settings-ui.themes.declined"));
                  })
                }
              >
                {text("settings-ui.themes.allow")}
              </button>
            </div>
          </div>
        )}

        {selected && presetNames.length > 0 && (
          <div class="field">
            <div class="field-text">
              <div class="field-label">{text("settings-ui.fields.theme-preset")}</div>
            </div>
            <div class="field-control">
              <select class="dropdown" value={pick} onChange={(e) => void model.setThemePreset(selected.id, e.currentTarget.value)}>
                {selected.palette !== undefined && (
                  <option value="">{text("main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.presets.default")}</option>
                )}
                {presetNames.map((preset) => (
                  <option key={preset} value={preset}>
                    {keyLabel(preset)}
                  </option>
                ))}
                <option value={CUSTOM_PRESET}>
                  {text("main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.presets.custom")}
                </option>
              </select>
            </div>
          </div>
        )}

        {selected && (
          <div class="field">
            <div class="field-label">{text("main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.colors.label")}</div>
            <div class="field-control">
              <PaletteEditor model={model} themeId={selected.id} palette={palette} />
            </div>
          </div>
        )}

        <div class="field actions">
          <button type="button" class="outlined" onClick={() => void model.importTheme()}>
            {text("main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.import-css-file")}
          </button>
          <button type="button" class="outlined" onClick={() => void model.openThemesFolder()}>
            {text("main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.open-themes-folder")}
          </button>
        </div>

        {failed && <p class="error-text">{failed}</p>}
      </div>
    </div>
  );
}

/** One text input per palette variable, committed when it loses focus or on Enter. */
function PaletteEditor(props: { model: SettingsModel; themeId: string; palette: ThemePalette }) {
  const text = useText();
  const entries = Object.entries(props.palette);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const add = () => {
    const key = newKey.trim();
    if (!key) return;
    void props.model.setThemePaletteValue(props.themeId, key, newValue);
    setNewKey("");
    setNewValue("");
  };

  return (
    <div class="theme-palette">
      {entries.length === 0 ? (
        <p class="theme-note">{text("settings-ui.themes.no-variables")}</p>
      ) : (
        entries.map(([key, value]) => (
          <div class="theme-palette-row" key={key}>
            <span class="theme-palette-key">{keyLabel(key)}</span>
            <PaletteValue value={value} onCommit={(next) => void props.model.setThemePaletteValue(props.themeId, key, next)} />
            <span class="theme-palette-swatch" style={{ background: value }} />
          </div>
        ))
      )}
      <div class="theme-palette-row">
        <input
          class="text theme-palette-name"
          type="text"
          spellcheck={false}
          placeholder={text("settings-ui.fields.theme-variable-name")}
          value={newKey}
          onInput={(e) => setNewKey(e.currentTarget.value)}
        />
        <input
          class="text"
          type="text"
          spellcheck={false}
          placeholder={text("settings-ui.fields.theme-variable-value")}
          value={newValue}
          onInput={(e) => setNewValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button type="button" class="outlined" disabled={newKey.trim() === ""} onClick={add}>
          {text("settings-ui.fields.theme-variable-add")}
        </button>
      </div>
      <button type="button" class="outlined" onClick={() => void props.model.resetThemePalette(props.themeId)}>
        {text("main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.reset-colors")}
      </button>
    </div>
  );
}

function PaletteValue(props: { value: string; onCommit(value: string): void }) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const commit = () => {
    if (draft !== props.value) props.onCommit(draft);
  };
  return (
    <input
      class="text"
      type="text"
      spellcheck={false}
      value={draft}
      onInput={(e) => setDraft(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
