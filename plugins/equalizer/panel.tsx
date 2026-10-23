/** @jsxImportSource @pear/sdk */
// The equalizer editor. The generated settings schema has no object fields, so
// the curve, band controls and presets live in this page-side panel, opened from
// the plugin's "Open equalizer" settings action.

import type { PageContextOf } from "@pear/sdk";
import { containScroll, isolateKeys, shadowHost } from "@pear/sdk/dom";
import { clamp } from "@pear/sdk/util";
import {
  BAND_FREQUENCIES,
  DEFAULT_Q,
  encodeBands,
  encodeUserPresets,
  FILTER_TYPES,
  filterTypeForBand,
  isFilterType,
  matchingPresetId,
  presetProfile,
  MAX_FREQUENCY,
  MAX_GAIN_DB,
  MAX_OUTPUT_GAIN_DB,
  MAX_RECENT_PRESETS,
  MAX_USER_PRESETS,
  MIN_FREQUENCY,
  MIN_GAIN_DB,
  MIN_OUTPUT_GAIN_DB,
  normalizeBand,
  normalizeBands,
  parsePresetImport,
  readConfig,
  type schema,
  type Band,
  type EqualizerConfig,
  type EqualizerState,
  type UserPreset,
} from "./config.ts";
import { interpolatedResponse } from "./response.ts";
import { PANEL_CSS } from "./style.ts";

type Ctx = PageContextOf<typeof schema>;

const WIDTH = 720;
const HEIGHT = 250;
const PAD_X = 42;
const PAD_Y = 22;
const SVG_NS = "http://www.w3.org/2000/svg";
const FREQUENCY_TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const GAIN_TICKS = [-30, -20, -10, 0, 10, 20, 30];
const RESERVED_NAMES: Readonly<Record<string, true>> = {
  custom: true,
  flat: true,
  "bass boost": true,
  "bass booster": true,
  "bass-booster": true,
};

const formatGain = (gain: number) => `${gain > 0 ? "+" : ""}${gain.toFixed(1)} dB`;
const formatFrequency = (frequency: number) =>
  frequency >= 1000 ? `${(frequency / 1000).toFixed(frequency >= 10000 ? 1 : 2)} kHz` : `${frequency.toFixed(frequency >= 100 ? 0 : 1)} Hz`;

const frequencyToX = (frequency: number) =>
  PAD_X +
  (Math.log10(clamp(frequency, MIN_FREQUENCY, MAX_FREQUENCY) / MIN_FREQUENCY) / Math.log10(MAX_FREQUENCY / MIN_FREQUENCY)) *
    (WIDTH - PAD_X * 2);

const xToFrequency = (x: number) =>
  MIN_FREQUENCY * (MAX_FREQUENCY / MIN_FREQUENCY) ** ((clamp(x, PAD_X, WIDTH - PAD_X) - PAD_X) / (WIDTH - PAD_X * 2));

const gainToY = (gain: number) =>
  PAD_Y + ((MAX_GAIN_DB - clamp(gain, MIN_GAIN_DB, MAX_GAIN_DB)) / (MAX_GAIN_DB - MIN_GAIN_DB)) * (HEIGHT - PAD_Y * 2);

const yToGain = (y: number) =>
  MAX_GAIN_DB - ((clamp(y, PAD_Y, HEIGHT - PAD_Y) - PAD_Y) / (HEIGHT - PAD_Y * 2)) * (MAX_GAIN_DB - MIN_GAIN_DB);

/** An SVG node; the DOM JSX runtime has no `<text>`, and attributes are all these need. */
function svgNode<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  // Reason: createElementNS's overload types every SVG tag as plain SVGElement.
  return element as SVGElementTagNameMap[K];
}

type BandControl = {
  card: HTMLFieldSetElement;
  legend: HTMLLegendElement;
  type: HTMLSelectElement;
  frequency: HTMLInputElement;
  q: HTMLInputElement;
  gain: HTMLInputElement;
  gainNumber: HTMLInputElement;
};

export function createEqualizerPanel(ctx: Ctx) {
  const { host, root } = shadowHost("pear-equalizer-panel", PANEL_CSS);
  host.hidden = true;

  let state: EqualizerState = readConfig(ctx.config);
  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let endDrag: (() => void) | undefined;
  /** Set when the user preset library changes, so drags don't rewrite it. */
  let presetsDirty = false;
  let stopped = false;

  const writeConfig = () => {
    if (stopped) return;
    const patch: Partial<EqualizerConfig> = {
      bypass: state.bypass,
      outputGainDb: state.outputGainDb,
      bands: encodeBands(state.bands),
      preset: state.activePreset,
      recentPresets: state.recentPresets,
    };
    if (presetsDirty) patch.userPresets = encodeUserPresets(state.userPresets);
    presetsDirty = false;
    ctx.setConfig(patch);
  };
  const flushConfig = () => {
    if (persistTimer !== undefined) {
      ctx.clearTimeout(persistTimer);
      persistTimer = undefined;
    }
    writeConfig();
  };
  const persistSoon = () => {
    // Throttle, not debounce: a continuous drag still reaches the audio graph
    // several times a second; the change/pointerup handlers flush the last value.
    if (persistTimer !== undefined) return;
    persistTimer = ctx.setTimeout(() => {
      persistTimer = undefined;
      writeConfig();
    }, 120);
  };
  const remember = (id: string) => [id, ...state.recentPresets.filter((item) => item !== id)].slice(0, MAX_RECENT_PRESETS);

  // ---------------------------------------------------------------- toolbar
  const bypassInput = (<input type="checkbox" />) as HTMLInputElement;
  const gainRange = (
    <input type="range" min={String(MIN_OUTPUT_GAIN_DB)} max={String(MAX_OUTPUT_GAIN_DB)} step="0.1" aria-label="Output gain" />
  ) as HTMLInputElement;
  const gainNumber = (
    <input
      type="number"
      min={String(MIN_OUTPUT_GAIN_DB)}
      max={String(MAX_OUTPUT_GAIN_DB)}
      step="0.1"
      aria-label="Output gain in decibels"
    />
  ) as HTMLInputElement;
  const gainValue = (<output />) as HTMLOutputElement;
  const toolbar = (
    <div class="peq-toolbar">
      <label class="peq-toggle">
        {bypassInput}
        Bypass
      </label>
      <label class="peq-gain">
        <span>Output gain</span>
        {gainRange}
        {gainNumber}
        {gainValue}
      </label>
    </div>
  );

  // ---------------------------------------------------------------- curve
  const svg = svgNode("svg", {
    class: "peq-svg",
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    role: "img",
    "aria-label": "Equalizer response curve",
  });
  svg.append(
    svgNode("rect", {
      class: "peq-plot",
      x: String(PAD_X),
      y: String(PAD_Y),
      width: String(WIDTH - PAD_X * 2),
      height: String(HEIGHT - PAD_Y * 2),
    }),
  );
  for (const gain of GAIN_TICKS) {
    const y = String(gainToY(gain));
    svg.append(svgNode("line", { class: "peq-grid", x1: String(PAD_X), x2: String(WIDTH - PAD_X), y1: y, y2: y }));
    const label = svgNode("text", {
      class: "peq-axis",
      "text-anchor": "end",
      x: String(PAD_X - 6),
      y: String(gainToY(gain) + 4),
    });
    label.textContent = gain > 0 ? `+${gain}` : String(gain);
    svg.append(label);
  }
  for (const frequency of FREQUENCY_TICKS) {
    const x = String(frequencyToX(frequency));
    svg.append(svgNode("line", { class: "peq-grid", x1: x, x2: x, y1: String(PAD_Y), y2: String(HEIGHT - PAD_Y) }));
    const label = svgNode("text", {
      class: "peq-axis",
      "text-anchor": "middle",
      x,
      y: String(HEIGHT - 5),
    });
    label.textContent = frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);
    svg.append(label);
  }
  svg.append(
    svgNode("line", {
      class: "peq-zero",
      x1: String(PAD_X),
      x2: String(WIDTH - PAD_X),
      y1: String(gainToY(0)),
      y2: String(gainToY(0)),
    }),
  );
  const curve = svgNode("path", { class: "peq-curve" });
  svg.append(curve);
  const dotTitles: SVGTitleElement[] = [];
  const dots = state.bands.map((_, index) => {
    const dot = svgNode("circle", {
      class: "peq-dot",
      r: "7",
      tabindex: "0",
      "aria-label": `Band ${index + 1}`,
    });
    const title = svgNode("title", {});
    dotTitles[index] = title;
    dot.append(title);
    dot.addEventListener("pointerdown", (event) => startDrag(event as PointerEvent, index));
    dot.addEventListener("dblclick", () => resetBand(index));
    dot.addEventListener("keydown", (event) => onDotKey(event as KeyboardEvent, index));
    svg.append(dot);
    return dot;
  });
  const graph = <div class="peq-graph">{svg}</div>;

  // ---------------------------------------------------------------- bands
  const controls = state.bands.map((_, index) => createBandCard(index));
  const bands = <div class="peq-bands">{controls.map((control) => control.card)}</div>;

  // ---------------------------------------------------------------- presets
  const presetSelect = (<select class="peq-select" aria-label="Preset" />) as HTMLSelectElement;
  const nameInput = (
    <input class="peq-text" type="text" maxLength={80} placeholder="Name this preset" aria-label="Preset name" />
  ) as HTMLInputElement;
  const saveButton = (
    <button class="peq-button peq-button--primary" type="button">
      Save
    </button>
  ) as HTMLButtonElement;
  const renameButton = (
    <button class="peq-button" type="button">
      Rename
    </button>
  ) as HTMLButtonElement;
  const deleteButton = (
    <button class="peq-button" type="button">
      Delete
    </button>
  ) as HTMLButtonElement;
  const resetButton = (
    <button class="peq-button" type="button">
      Reset
    </button>
  ) as HTMLButtonElement;
  const exportButton = (
    <button class="peq-button" type="button">
      Export
    </button>
  ) as HTMLButtonElement;
  const fileInput = (<input type="file" accept="application/json,.json" aria-label="Import presets" />) as HTMLInputElement;
  const importButton = (
    <label class="peq-button peq-import">
      Import
      {fileInput}
    </label>
  ) as HTMLLabelElement;
  const flatButton = (
    <button class="peq-button" type="button">
      Flat
    </button>
  ) as HTMLButtonElement;
  const bassButton = (
    <button class="peq-button" type="button">
      Bass booster
    </button>
  ) as HTMLButtonElement;
  const recentChips = (<div class="peq-chips" />) as HTMLDivElement;
  const recentRow = (
    <div class="peq-recent">
      <span>Recent</span>
      {recentChips}
    </div>
  ) as HTMLDivElement;
  const notice = (<p class="peq-notice" aria-live="polite" />) as HTMLParagraphElement;

  const presetsSection = (
    <section class="peq-presets">
      <div class="peq-preset-row">
        <label class="peq-field">
          <span>Preset</span>
          {presetSelect}
        </label>
        <label class="peq-field peq-field--name">
          <span>Name</span>
          {nameInput}
        </label>
      </div>
      <div class="peq-actions">
        {flatButton}
        {bassButton}
        {saveButton}
        {renameButton}
        {deleteButton}
        {resetButton}
        {exportButton}
        {importButton}
      </div>
      {recentRow}
      {notice}
    </section>
  );

  const closeButton = (
    <button class="peq-close" type="button" aria-label="Close equalizer">
      ×
    </button>
  ) as HTMLButtonElement;
  const panel = (
    <section class="peq-panel" role="dialog" aria-modal="true" aria-labelledby="peq-title" tabIndex={-1}>
      <header class="peq-header">
        <h2 class="peq-title" id="peq-title">
          Equalizer
        </h2>
        {closeButton}
      </header>
      <div class="peq-content">
        {toolbar}
        {graph}
        {bands}
        {presetsSection}
      </div>
    </section>
  ) as HTMLElement;
  const backdrop = (<div class="peq-backdrop">{panel}</div>) as HTMLDivElement;
  root.append(backdrop);

  let opened = false;

  // ---------------------------------------------------------------- state → UI
  function showNotice(message: string) {
    notice.textContent = message;
    if (noticeTimer !== undefined) ctx.clearTimeout(noticeTimer);
    noticeTimer = ctx.setTimeout(() => {
      noticeTimer = undefined;
      notice.textContent = "";
    }, 5000);
  }

  function renderToolbar() {
    bypassInput.checked = state.bypass;
    if (root.activeElement !== gainRange) gainRange.value = String(state.outputGainDb);
    if (root.activeElement !== gainNumber) gainNumber.value = state.outputGainDb.toFixed(1);
    gainValue.textContent = formatGain(state.outputGainDb);
  }

  function renderBand(index: number) {
    const band = state.bands[index];
    const control = controls[index];
    if (!band || !control) return;
    control.legend.textContent = `${index + 1}. ${formatFrequency(band.frequency)}`;
    if (control.type.value !== band.type) control.type.value = band.type;
    if (root.activeElement !== control.frequency) control.frequency.value = String(Number(band.frequency.toFixed(2)));
    if (root.activeElement !== control.q) control.q.value = String(Number(band.Q.toFixed(2)));
    if (root.activeElement !== control.gain) control.gain.value = String(band.gain);
    if (root.activeElement !== control.gainNumber) control.gainNumber.value = band.gain.toFixed(1);
  }

  function renderCurve() {
    curve.setAttribute(
      "d",
      interpolatedResponse(state.bands)
        .map((point, index) => `${index === 0 ? "M" : "L"} ${frequencyToX(point.frequency).toFixed(2)} ${gainToY(point.db).toFixed(2)}`)
        .join(" "),
    );
    state.bands.forEach((band, index) => {
      const dot = dots[index];
      if (!dot) return;
      dot.setAttribute("cx", String(frequencyToX(band.frequency)));
      dot.setAttribute("cy", String(gainToY(band.gain)));
      dot.setAttribute("class", band.type === "lowshelf" || band.type === "highshelf" ? "peq-dot peq-dot--shelf" : "peq-dot");
      const description = `${index + 1}: ${formatFrequency(band.frequency)}, ${formatGain(band.gain)}, Q ${band.Q.toFixed(2)}`;
      dot.setAttribute("aria-label", description);
      const title = dotTitles[index];
      if (title) title.textContent = description;
    });
  }

  function renderBands() {
    state.bands.forEach((_, index) => renderBand(index));
    renderCurve();
  }

  function presetLabel(id: string) {
    if (id === "flat") return "Flat";
    if (id === "bass-booster") return "Bass booster";
    if (id === "custom") return "Custom";
    return state.userPresets.find((preset) => preset.id === id)?.name ?? id;
  }

  function syncPresetControls() {
    const user = state.userPresets.find((preset) => preset.id === state.activePreset);
    const hasOption = [...presetSelect.options].some((option) => option.value === state.activePreset);
    if (hasOption && presetSelect.value !== state.activePreset) presetSelect.value = state.activePreset;
    renameButton.disabled = !user;
    deleteButton.disabled = !user;
    if (root.activeElement !== nameInput) nameInput.value = user?.name ?? "";
    for (const chip of recentChips.children) {
      if (!(chip instanceof HTMLElement)) continue;
      const id = chip.dataset.id;
      if (id) chip.setAttribute("aria-pressed", String(state.activePreset === id));
    }
  }

  function renderPresets() {
    const options = [
      { id: "custom", label: "Custom" },
      { id: "flat", label: "Flat" },
      { id: "bass-booster", label: "Bass booster" },
      ...state.userPresets.map((preset) => ({ id: preset.id, label: preset.name })),
    ];
    presetSelect.replaceChildren(
      ...options.map(({ id, label }) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = label;
        return option;
      }),
    );
    if (!options.some((option) => option.id === state.activePreset)) state.activePreset = "custom";
    presetSelect.value = state.activePreset;

    recentChips.replaceChildren();
    recentRow.hidden = state.recentPresets.length === 0;
    for (const id of state.recentPresets) {
      const chip = (
        <button class="peq-button peq-chip" type="button">
          {presetLabel(id)}
        </button>
      ) as HTMLButtonElement;
      chip.dataset.id = id;
      chip.setAttribute("aria-pressed", String(state.activePreset === id));
      chip.addEventListener("click", () => applyPreset(id));
      recentChips.append(chip);
    }
    syncPresetControls();
  }

  function renderAll() {
    renderToolbar();
    renderBands();
    renderPresets();
  }

  // ---------------------------------------------------------------- edits
  function updateBand(index: number, patch: Partial<Band>) {
    const current = state.bands[index];
    if (!current) return;
    state.bands = state.bands.map((band, bandIndex) => (bandIndex === index ? normalizeBand({ ...band, ...patch }, index) : band));
    state.activePreset = matchingPresetId(state) ?? "custom";
    renderBand(index);
    renderCurve();
    syncPresetControls();
    persistSoon();
  }

  function resetBand(index: number) {
    const band = state.bands[index];
    if (!band) return;
    updateBand(index, {
      type: filterTypeForBand(index),
      frequency: BAND_FREQUENCIES[index] ?? band.frequency,
      Q: DEFAULT_Q,
      gain: 0,
    });
    flushConfig();
  }

  function setOutputGain(value: number) {
    if (!Number.isFinite(value)) return;
    state.outputGainDb = clamp(value, MIN_OUTPUT_GAIN_DB, MAX_OUTPUT_GAIN_DB);
    state.activePreset = matchingPresetId(state) ?? "custom";
    renderToolbar();
    syncPresetControls();
    persistSoon();
  }

  function applyPreset(id: string) {
    const profile = presetProfile(id, state.userPresets);
    if (!profile) return;
    state.bands = normalizeBands(profile.bands);
    const outputGainDb = profile.outputGainDb;
    if (outputGainDb !== undefined) {
      state.outputGainDb = clamp(outputGainDb, MIN_OUTPUT_GAIN_DB, MAX_OUTPUT_GAIN_DB);
    }
    state.activePreset = id;
    state.recentPresets = remember(id);
    renderAll();
    flushConfig();
    showNotice(`Applied ${presetLabel(id)}.`);
  }

  function savePreset() {
    const name = nameInput.value.trim().slice(0, 80);
    if (!name) {
      showNotice("Give the preset a name first.");
      return;
    }
    if (Object.hasOwn(RESERVED_NAMES, name.toLowerCase())) {
      showNotice("That name is reserved for a built-in preset.");
      return;
    }
    const existing = state.userPresets.find((preset) => preset.name.toLowerCase() === name.toLowerCase());
    if (!existing && state.userPresets.length >= MAX_USER_PRESETS) {
      showNotice(`You can keep up to ${MAX_USER_PRESETS} presets.`);
      return;
    }
    if (existing && !window.confirm(`Replace “${existing.name}”?`)) return;
    const preset: UserPreset = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      bands: state.bands.map((band) => ({ ...band })),
      outputGainDb: state.outputGainDb,
    };
    state.userPresets = existing
      ? state.userPresets.map((item) => (item.id === existing.id ? preset : item))
      : [...state.userPresets, preset];
    state.activePreset = preset.id;
    state.recentPresets = remember(preset.id);
    presetsDirty = true;
    renderAll();
    flushConfig();
    showNotice(`Saved “${name}”.`);
  }

  function renamePreset() {
    const selected = state.userPresets.find((preset) => preset.id === state.activePreset);
    if (!selected) {
      showNotice("Select one of your presets first.");
      return;
    }
    const name = nameInput.value.trim().slice(0, 80);
    if (!name) {
      showNotice("Give the preset a name first.");
      return;
    }
    if (Object.hasOwn(RESERVED_NAMES, name.toLowerCase())) {
      showNotice("That name is reserved for a built-in preset.");
      return;
    }
    if (state.userPresets.some((preset) => preset.id !== selected.id && preset.name.toLowerCase() === name.toLowerCase())) {
      showNotice("Another preset already has that name.");
      return;
    }
    state.userPresets = state.userPresets.map((preset) => (preset.id === selected.id ? { ...preset, name } : preset));
    presetsDirty = true;
    renderAll();
    flushConfig();
    showNotice(`Renamed to “${name}”.`);
  }

  function deletePreset() {
    const selected = state.userPresets.find((preset) => preset.id === state.activePreset);
    if (!selected) {
      showNotice("Select one of your presets first.");
      return;
    }
    if (!window.confirm(`Delete “${selected.name}”?`)) return;
    state.userPresets = state.userPresets.filter((preset) => preset.id !== selected.id);
    state.recentPresets = state.recentPresets.filter((id) => id !== selected.id);
    if (state.activePreset === selected.id) state.activePreset = "custom";
    presetsDirty = true;
    renderAll();
    flushConfig();
    showNotice(`Deleted “${selected.name}”.`);
  }

  function exportPresets() {
    if (state.userPresets.length === 0) {
      showNotice("There are no presets to export yet.");
      return;
    }
    const file = new Blob([JSON.stringify({ version: 2, presets: state.userPresets }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "pear-equalizer-presets.json";
    anchor.click();
    ctx.setTimeout(() => URL.revokeObjectURL(url), 0);
    showNotice(`Exported ${state.userPresets.length} preset${state.userPresets.length === 1 ? "" : "s"}.`);
  }

  async function importPresets(file: File | undefined) {
    if (!file) return;
    try {
      const imported = parsePresetImport(await file.text());
      if (imported.length === 0) {
        showNotice("That file has no presets in a format this equalizer understands.");
        return;
      }
      const next = [...state.userPresets];
      for (const preset of imported) {
        if (next.length >= MAX_USER_PRESETS) break;
        const base = preset.name.slice(0, 70);
        let name = preset.name;
        let suffix = 1;
        while (next.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
          name = `${base} (${suffix++})`;
        }
        let id = preset.id;
        while (next.some((item) => item.id === id)) id = crypto.randomUUID();
        next.push({ ...preset, id, name });
      }
      const added = next.length - state.userPresets.length;
      state.userPresets = next;
      presetsDirty = true;
      renderAll();
      flushConfig();
      showNotice(added > 0 ? `Imported ${added} preset${added === 1 ? "" : "s"}.` : "No room for more presets.");
    } catch {
      showNotice("That file isn't a valid preset export.");
    }
  }

  // ---------------------------------------------------------------- events
  function startDrag(event: PointerEvent, index: number) {
    event.preventDefault();
    endDrag?.();
    const band = state.bands[index];
    if (!band) return;
    const pointerId = event.pointerId;
    const start = { x: event.clientX, y: event.clientY, Q: band.Q };
    try {
      svg.setPointerCapture(pointerId);
    } catch {
      // Pointer capture is an enhancement; the window listeners still track it.
    }
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (moveEvent.shiftKey) {
        updateBand(index, { Q: start.Q * 2 ** ((moveEvent.clientY - start.y) / 60) });
        return;
      }
      const x = ((moveEvent.clientX - rect.left) / rect.width) * WIDTH;
      const y = ((moveEvent.clientY - rect.top) / rect.height) * HEIGHT;
      updateBand(index, { frequency: xToFrequency(x), gain: yToGain(y) });
    };
    const finish = (finishEvent?: PointerEvent) => {
      if (finishEvent && finishEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finishPointer);
      window.removeEventListener("pointercancel", finishPointer);
      window.removeEventListener("blur", finishBlur);
      try {
        svg.releasePointerCapture(pointerId);
      } catch {
        // The browser may have released it already.
      }
      endDrag = undefined;
      flushConfig();
    };
    const finishPointer = (finishEvent: PointerEvent) => finish(finishEvent);
    const finishBlur = () => finish();
    endDrag = finish;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finishPointer);
    window.addEventListener("pointercancel", finishPointer);
    window.addEventListener("blur", finishBlur);
  }

  function onDotKey(event: KeyboardEvent, index: number) {
    const band = state.bands[index];
    if (!band) return;
    const step = event.shiftKey ? 2 : 0.5;
    let patch: Partial<Band> | undefined;
    switch (event.key) {
      case "ArrowUp":
        patch = { gain: band.gain + step };
        break;
      case "ArrowDown":
        patch = { gain: band.gain - step };
        break;
      case "ArrowLeft":
        patch = { frequency: band.frequency / 2 ** (1 / 12) };
        break;
      case "ArrowRight":
        patch = { frequency: band.frequency * 2 ** (1 / 12) };
        break;
      default:
        return;
    }
    if (!patch) return;
    event.preventDefault();
    updateBand(index, patch);
    flushConfig();
  }

  function createBandCard(index: number): BandControl {
    const legend = (<legend />) as HTMLLegendElement;
    const type = (<select class="peq-select" aria-label={`Band ${index + 1} type`} />) as HTMLSelectElement;
    for (const value of FILTER_TYPES) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent =
        value === "lowshelf" ? "Low shelf" : value === "highshelf" ? "High shelf" : value[0]!.toUpperCase() + value.slice(1);
      type.append(option);
    }
    const frequency = (
      <input
        class="peq-number"
        type="number"
        min={String(MIN_FREQUENCY)}
        max={String(MAX_FREQUENCY)}
        step="0.1"
        aria-label={`Band ${index + 1} frequency`}
      />
    ) as HTMLInputElement;
    const q = (
      <input class="peq-number" type="number" min="0.1" max="30" step="0.01" aria-label={`Band ${index + 1} Q`} />
    ) as HTMLInputElement;
    const gain = (
      <input
        class="peq-range"
        type="range"
        min={String(MIN_GAIN_DB)}
        max={String(MAX_GAIN_DB)}
        step="0.1"
        aria-label={`Band ${index + 1} gain`}
      />
    ) as HTMLInputElement;
    const gainNumber = (
      <input
        class="peq-number"
        type="number"
        min={String(MIN_GAIN_DB)}
        max={String(MAX_GAIN_DB)}
        step="0.1"
        aria-label={`Band ${index + 1} gain in decibels`}
      />
    ) as HTMLInputElement;

    type.addEventListener("change", () => {
      const nextType = type.value;
      if (isFilterType(nextType)) updateBand(index, { type: nextType });
    });
    frequency.addEventListener("change", () => {
      if (Number.isFinite(frequency.valueAsNumber)) updateBand(index, { frequency: frequency.valueAsNumber });
      else renderBand(index);
      frequency.value = String(Number(state.bands[index]?.frequency.toFixed(2) ?? MIN_FREQUENCY));
      flushConfig();
    });
    q.addEventListener("change", () => {
      if (Number.isFinite(q.valueAsNumber)) updateBand(index, { Q: q.valueAsNumber });
      else renderBand(index);
      q.value = String(Number(state.bands[index]?.Q.toFixed(2) ?? DEFAULT_Q));
      flushConfig();
    });
    gain.addEventListener("input", () => updateBand(index, { gain: gain.valueAsNumber }));
    gain.addEventListener("change", flushConfig);
    gainNumber.addEventListener("change", () => {
      if (Number.isFinite(gainNumber.valueAsNumber)) updateBand(index, { gain: gainNumber.valueAsNumber });
      else renderBand(index);
      gainNumber.value = (state.bands[index]?.gain ?? 0).toFixed(1);
      flushConfig();
    });

    const card = (
      <fieldset class="peq-band">
        {legend}
        <label class="peq-control">
          <span>Type</span>
          {type}
        </label>
        <label class="peq-control">
          <span>Frequency</span>
          {frequency}
        </label>
        <div class="peq-control">
          <span>Gain</span>
          {gain}
          {gainNumber}
        </div>
        <label class="peq-control">
          <span>Q</span>
          {q}
        </label>
        <button
          type="button"
          aria-label={`Reset band ${index + 1}`}
          onClick={() => {
            resetBand(index);
            showNotice(`Band ${index + 1} reset.`);
          }}
        >
          Reset
        </button>
      </fieldset>
    ) as HTMLFieldSetElement;
    return { card, legend, type, frequency, q, gain, gainNumber };
  }

  const open = () => {
    host.hidden = false;
    opened = true;
    renderAll();
    closeButton.focus();
  };
  const close = () => {
    endDrag?.();
    host.hidden = true;
    opened = false;
  };

  bypassInput.addEventListener("change", () => {
    state.bypass = bypassInput.checked;
    flushConfig();
  });
  gainRange.addEventListener("input", () => setOutputGain(gainRange.valueAsNumber));
  gainRange.addEventListener("change", flushConfig);
  gainNumber.addEventListener("change", () => {
    if (Number.isFinite(gainNumber.valueAsNumber)) setOutputGain(gainNumber.valueAsNumber);
    else renderToolbar();
    gainNumber.value = state.outputGainDb.toFixed(1);
    flushConfig();
  });
  presetSelect.addEventListener("change", () => {
    if (presetSelect.value === "custom") {
      state.activePreset = "custom";
      syncPresetControls();
      persistSoon();
      return;
    }
    applyPreset(presetSelect.value);
  });
  flatButton.addEventListener("click", () => applyPreset("flat"));
  bassButton.addEventListener("click", () => applyPreset("bass-booster"));
  saveButton.addEventListener("click", savePreset);
  renameButton.addEventListener("click", renamePreset);
  deleteButton.addEventListener("click", deletePreset);
  resetButton.addEventListener("click", () => {
    applyPreset("flat");
    showNotice("Equalizer reset to flat.");
  });
  exportButton.addEventListener("click", exportPresets);
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    void importPresets(file);
  });
  nameInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    savePreset();
  });
  closeButton.addEventListener("click", () => close());
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });

  ctx.onConfigChange((config) => {
    const next = readConfig(config);
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    renderAll();
  });
  ctx.listen(
    document,
    "keydown",
    (event: KeyboardEvent) => {
      if (!opened) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...panel.querySelectorAll<HTMLElement>("button, input, select, [tabindex='0']")].filter(
        (element) => !element.hasAttribute("disabled"),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && root.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && root.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    { capture: true },
  );
  isolateKeys(host, ctx.signal);
  containScroll(backdrop, ctx.signal);
  const content = panel.querySelector(".peq-content");
  if (content instanceof HTMLElement) containScroll(content, ctx.signal);
  ctx.mount(host, (element) => {
    if (!element.isConnected) document.body.append(element);
  });
  ctx.onCleanup(() => {
    stopped = true;
    if (noticeTimer !== undefined) ctx.clearTimeout(noticeTimer);
    if (persistTimer !== undefined) {
      ctx.clearTimeout(persistTimer);
      persistTimer = undefined;
    }
    endDrag?.();
  });

  renderAll();
  return { open, close };
}
