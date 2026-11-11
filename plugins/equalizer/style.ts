// The equalizer panel lives in a shadow root, so YTM's styles never leak in.
// Material 3 dark surfaces, the graph as the primary control, and compact
// per-band cards underneath.

import { css } from "@pear/sdk/macros" with { type: "macro" };

export const PANEL_CSS = css`
  :host {
    --peq-primary: #d0bcff;
    --peq-on-primary: #381e72;
    --peq-primary-container: #4f378b;
    --peq-on-primary-container: #eaddff;
    --peq-tertiary: #efb8c8;
    --peq-surface: #141218;
    --peq-surface-container: #211f26;
    --peq-surface-high: #2b2930;
    --peq-on-surface: #e6e0e9;
    --peq-on-surface-variant: #cac4d0;
    --peq-outline: #49454f;
    --peq-outline-variant: #938f99;
    position: fixed;
    inset: 0;
    z-index: 2147483600;
    display: block;
    color-scheme: dark;
  }

  :host([hidden]) {
    display: none;
  }

  [hidden] {
    display: none !important;
  }

  .peq-backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgb(0 0 0 / 0.62);
    backdrop-filter: blur(6px);
    animation: peq-backdrop-in 180ms ease-out;
  }

  .peq-panel {
    display: flex;
    flex-direction: column;
    width: min(1040px, 100%);
    max-height: min(92vh, 920px);
    overflow: hidden;
    border: 1px solid var(--peq-outline);
    border-radius: 28px;
    background: var(--peq-surface);
    color: var(--peq-on-surface);
    box-shadow:
      0 8px 12px 6px rgb(0 0 0 / 0.15),
      0 24px 80px rgb(0 0 0 / 0.55);
    font:
      400 14px/1.45 Roboto,
      system-ui,
      sans-serif;
    animation: peq-panel-in 220ms cubic-bezier(0.2, 0, 0, 1);
  }

  .peq-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 18px 22px 14px;
    border-bottom: 1px solid var(--peq-outline-variant);
  }

  .peq-title {
    flex: 1;
    margin: 0;
    font-size: 22px;
    font-weight: 500;
    letter-spacing: -0.01em;
  }

  .peq-close {
    display: grid;
    width: 40px;
    height: 40px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--peq-on-surface-variant);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
  }

  .peq-close:hover {
    background: var(--peq-surface-high);
    color: var(--peq-on-surface);
  }

  .peq-close:focus-visible,
  .peq-button:focus-visible,
  .peq-band button:focus-visible,
  input:focus-visible,
  select:focus-visible {
    outline: 3px solid var(--peq-primary);
    outline-offset: 2px;
  }

  .peq-content {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-height: 0;
    overflow: auto;
    padding: 16px 22px 24px;
    overscroll-behavior: contain;
  }

  .peq-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
    align-items: center;
    padding: 12px 14px;
    border-radius: 18px;
    background: var(--peq-surface-container);
  }

  .peq-toggle {
    display: flex;
    gap: 9px;
    align-items: center;
    font-weight: 500;
  }

  .peq-toggle input {
    width: 18px;
    height: 18px;
    accent-color: var(--peq-primary);
  }

  .peq-gain {
    display: flex;
    flex: 1 1 320px;
    gap: 10px;
    align-items: center;
    min-width: 240px;
  }

  .peq-gain > span {
    color: var(--peq-on-surface-variant);
    font-size: 12px;
  }

  .peq-gain output {
    min-width: 64px;
    color: var(--peq-on-surface);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .peq-graph {
    flex: 0 0 auto;
    position: sticky;
    top: 0;
    z-index: 2;
    overflow: hidden;
    border: 1px solid var(--peq-outline);
    border-radius: 22px;
    background: var(--peq-surface-container);
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.24);
  }

  .peq-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    justify-content: space-between;
    color: var(--peq-on-surface-variant);
    font-size: 12px;
  }

  .peq-legend .peq-button {
    flex: 0 0 auto;
  }

  .peq-svg {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 720 / 250;
    touch-action: none;
  }

  .peq-plot {
    fill: color-mix(in srgb, var(--peq-primary) 4%, transparent);
    stroke: var(--peq-outline);
  }

  .peq-grid {
    stroke: color-mix(in srgb, var(--peq-outline-variant) 32%, transparent);
    stroke-width: 1;
  }

  .peq-zero {
    stroke: color-mix(in srgb, var(--peq-tertiary) 72%, transparent);
    stroke-width: 1.25;
  }

  .peq-axis {
    fill: var(--peq-on-surface-variant);
    font-size: 10px;
    font-family: inherit;
  }

  .peq-curve {
    fill: none;
    stroke: var(--peq-primary);
    stroke-width: 2.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    filter: drop-shadow(0 0 5px color-mix(in srgb, var(--peq-primary) 55%, transparent));
  }

  .peq-dot {
    fill: var(--peq-primary);
    stroke: var(--peq-surface);
    stroke-width: 2.5;
    cursor: grab;
  }

  .peq-dot:active {
    cursor: grabbing;
  }

  .peq-dot--shelf {
    fill: var(--peq-tertiary);
  }

  .peq-dot:focus-visible {
    outline: 2px solid var(--peq-on-surface);
    outline-offset: 3px;
  }

  .peq-bands {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
  }

  .peq-band {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    margin: 0;
    padding: 12px 14px 14px;
    border: 1px solid var(--peq-outline);
    border-radius: 20px;
    background: var(--peq-surface-container);
  }

  .peq-band legend {
    padding: 0 5px;
    color: var(--peq-on-surface);
    font-size: 13px;
    font-weight: 500;
  }

  .peq-control {
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
    color: var(--peq-on-surface-variant);
    font-size: 11px;
  }

  .peq-control > span {
    width: 66px;
    flex: 0 0 auto;
  }

  .peq-control input[type="number"],
  .peq-gain input[type="number"],
  .peq-select,
  .peq-text {
    width: 100%;
    min-width: 0;
    padding: 6px 9px;
    border: 1px solid var(--peq-outline);
    border-radius: 10px;
    background: var(--peq-surface-high);
    color: var(--peq-on-surface);
    font: inherit;
    font-size: 12px;
  }

  .peq-control input[type="range"],
  .peq-gain input[type="range"] {
    flex: 1;
    min-width: 50px;
    accent-color: var(--peq-primary);
  }

  .peq-number {
    max-width: 82px;
  }

  .peq-band button,
  .peq-button {
    padding: 7px 14px;
    border: 1px solid var(--peq-outline);
    border-radius: 999px;
    background: transparent;
    color: var(--peq-on-surface-variant);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    transition:
      background-color 140ms ease,
      color 140ms ease,
      border-color 140ms ease;
  }

  .peq-band button:hover,
  .peq-button:hover {
    background: var(--peq-surface-high);
    color: var(--peq-on-surface);
  }

  .peq-button:disabled {
    opacity: 0.38;
    cursor: default;
  }

  .peq-button--primary {
    border-color: transparent;
    background: var(--peq-primary);
    color: var(--peq-on-primary);
    font-weight: 600;
  }

  .peq-button--primary:hover {
    background: var(--peq-on-primary-container);
    color: var(--peq-on-primary);
  }

  .peq-presets {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 16px;
    border-top: 1px solid var(--peq-outline-variant);
  }

  .peq-preset-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: flex-end;
  }

  .peq-field {
    display: flex;
    flex: 1 1 190px;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
    color: var(--peq-on-surface-variant);
    font-size: 12px;
  }

  .peq-field--name {
    flex: 2 1 230px;
  }

  .peq-actions,
  .peq-recent {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .peq-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .peq-recent > span {
    color: var(--peq-on-surface-variant);
    font-size: 12px;
  }

  .peq-chip[aria-pressed="true"] {
    border-color: var(--peq-primary);
    background: var(--peq-primary-container);
    color: var(--peq-on-primary-container);
  }

  .peq-import {
    position: relative;
    display: inline-flex;
    align-items: center;
    overflow: hidden;
  }

  .peq-import input {
    position: absolute;
    inset: 0;
    width: 100%;
    opacity: 0;
    cursor: pointer;
  }

  .peq-notice {
    min-height: 18px;
    margin: 0;
    color: var(--peq-on-surface-variant);
    font-size: 12px;
  }

  @keyframes peq-backdrop-in {
    from {
      opacity: 0;
    }
  }

  @keyframes peq-panel-in {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.96);
    }
  }

  :host([data-closing]) .peq-backdrop {
    animation: peq-backdrop-out 160ms ease-in forwards;
  }

  :host([data-closing]) .peq-panel {
    animation: peq-panel-out 160ms ease-in forwards;
  }

  @keyframes peq-backdrop-out {
    to {
      opacity: 0;
    }
  }

  @keyframes peq-panel-out {
    to {
      opacity: 0;
      transform: translateY(8px) scale(0.97);
    }
  }

  @media (max-width: 640px) {
    .peq-backdrop {
      padding: 0;
    }

    .peq-panel {
      width: 100%;
      max-height: 100vh;
      border-radius: 0;
      animation: none;
    }

    .peq-content {
      padding: 12px 14px 18px;
    }

    .peq-bands {
      grid-template-columns: 1fr;
    }

    .peq-graph {
      position: static;
    }
  }
`;
