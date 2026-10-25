import { css } from "@pear/sdk/macros" with { type: "macro" };

/** The Theme card: palette rows, their swatches and notes. */
export const theme = css`
  .theme-note {
    margin: 0;
    padding: 10px 18px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--on-surface-variant);
  }
  .theme-palette {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  .theme-palette-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
  }
  .theme-palette-key {
    flex: 0 0 140px;
    font-size: 13px;
    color: var(--on-surface-variant);
  }
  .theme-palette .text {
    flex: 1;
    min-width: 0;
  }
  .theme-palette-name {
    max-width: 180px;
  }
  .theme-palette-swatch {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    border: 1px solid var(--edge);
    border-radius: 50%;
  }
`;
