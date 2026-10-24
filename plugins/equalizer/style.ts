// The equalizer panel lives in a shadow root, so YTM's styles never leak in.

import { css } from "@pear/sdk/macros" with { type: "macro" };

export const PANEL_CSS = css`
  :host {
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
    backdrop-filter: blur(5px);
  }

  .peq-panel {
    display: flex;
    flex-direction: column;
    width: min(980px, 100%);
    max-height: min(92vh, 920px);
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.14);
    border-radius: 18px;
    background: #181818;
    color: #f1f1f1;
    box-shadow: 0 24px 80px rgb(0 0 0 / 0.6);
    font:
      400 14px/1.4 Roboto,
      sans-serif;
  }

  .peq-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 18px;
    border-bottom: 1px solid rgb(255 255 255 / 0.1);
  }

  .peq-title {
    flex: 1;
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .peq-close {
    width: 34px;
    height: 34px;
    border: 0;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.08);
    color: inherit;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
  }

  .peq-close:hover {
    background: rgb(255 255 255 / 0.16);
  }

  .peq-content {
    display: flex;
    flex-direction: column;
    gap: 18px;
    min-height: 0;
    overflow: auto;
    padding: 16px 18px 22px;
    overscroll-behavior: contain;
  }

  .peq-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
    align-items: center;
  }

  .peq-toggle {
    display: flex;
    gap: 8px;
    align-items: center;
    font-weight: 500;
  }

  .peq-gain {
    display: flex;
    flex: 1 1 320px;
    gap: 10px;
    align-items: center;
    min-width: 240px;
  }

  .peq-gain > span {
    color: #aaa;
    font-size: 12px;
  }

  .peq-gain output {
    min-width: 64px;
    color: #ddd;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .peq-graph {
    overflow: hidden;
    border: 1px solid rgb(255 255 255 / 0.12);
    border-radius: 14px;
    background: #101010;
  }

  .peq-svg {
    display: block;
    width: 100%;
    height: auto;
    touch-action: none;
  }

  .peq-plot {
    fill: rgb(255 255 255 / 0.02);
    stroke: rgb(255 255 255 / 0.12);
  }

  .peq-grid {
    stroke: rgb(255 255 255 / 0.08);
    stroke-width: 1;
  }

  .peq-zero {
    stroke: rgb(255 201 94 / 0.55);
    stroke-width: 1.25;
  }

  .peq-axis {
    fill: #8f8f8f;
    font-size: 10px;
    font-family: inherit;
  }

  .peq-curve {
    fill: none;
    stroke: #ff4e45;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .peq-dot {
    fill: #ff4e45;
    stroke: #101010;
    stroke-width: 2;
    cursor: grab;
  }

  .peq-dot:active {
    cursor: grabbing;
  }

  .peq-dot--shelf {
    fill: #6ee7c8;
  }

  .peq-dot:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 3px;
  }

  .peq-bands {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(195px, 1fr));
    gap: 10px;
  }

  .peq-band {
    display: flex;
    flex-direction: column;
    gap: 7px;
    min-width: 0;
    margin: 0;
    padding: 10px;
    border: 1px solid rgb(255 255 255 / 0.1);
    border-radius: 12px;
    background: #202020;
  }

  .peq-band legend {
    padding: 0 4px;
    font-size: 13px;
    font-weight: 600;
  }

  .peq-control {
    display: flex;
    gap: 7px;
    align-items: center;
    min-width: 0;
    color: #aaa;
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
    padding: 4px 6px;
    border: 1px solid rgb(255 255 255 / 0.16);
    border-radius: 7px;
    background: #2b2b2b;
    color: inherit;
    font: inherit;
    font-size: 12px;
  }

  .peq-control input[type="range"],
  .peq-gain input[type="range"] {
    flex: 1;
    min-width: 50px;
    accent-color: #ff4e45;
  }

  .peq-number {
    max-width: 82px;
  }

  .peq-band button,
  .peq-button {
    padding: 5px 10px;
    border: 1px solid rgb(255 255 255 / 0.18);
    border-radius: 999px;
    background: rgb(255 255 255 / 0.06);
    color: inherit;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .peq-band button:hover,
  .peq-button:hover {
    background: rgb(255 255 255 / 0.14);
  }

  .peq-button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .peq-button--primary {
    border-color: transparent;
    background: #ff4e45;
    color: #1a0000;
    font-weight: 600;
  }

  .peq-presets {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 16px;
    border-top: 1px solid rgb(255 255 255 / 0.1);
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
    gap: 4px;
    min-width: 0;
    color: #aaa;
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
    color: #aaa;
    font-size: 12px;
  }

  .peq-chip[aria-pressed="true"] {
    border-color: #ff4e45;
    background: rgb(255 78 69 / 0.18);
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
    color: #aaa;
    font-size: 12px;
  }

  @media (max-width: 640px) {
    .peq-backdrop {
      padding: 0;
    }

    .peq-panel {
      width: 100%;
      max-height: 100vh;
      border-radius: 0;
    }

    .peq-bands {
      grid-template-columns: 1fr;
    }
  }
`;
