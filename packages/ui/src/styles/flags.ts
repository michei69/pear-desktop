import { css } from "@pear/sdk/macros" with { type: "macro" };

/** The Flags section: the warning, the add row and the flag rows. */
export const flags = css`
  /* Standing warning, shown every time the section is opened. */
  .flags-warning {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 16px;
    padding: 12px 16px;
    border-radius: 14px;
    background: var(--tertiary-container);
    color: var(--on-tertiary-container);
    font-size: 13px;
    line-height: 1.4;
  }
  .flags-warning .icon {
    margin-top: 1px;
  }
  /* Flag names are identifiers, not prose. */
  .flags-name {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    word-break: break-all;
  }
  /* Four tags can crowd a long name, so let them wrap instead of squeezing it. */
  .flags .label-line {
    flex-wrap: wrap;
  }
  /* The family tag sits next to the overridden one, in the app's own accent. */
  .flags-family {
    background: transparent;
    border: 1px solid var(--outline);
    color: var(--primary);
  }
  .flags-undo {
    flex-shrink: 0;
    padding: 6px 14px;
    font-size: 12px;
  }
  /* Add and Undo share it: neither does anything while it is off. */
  .flags .field-button:disabled {
    cursor: default;
    opacity: 0.38;
    background: transparent;
  }
  .flags-add {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
  }
  .flags-add-name {
    flex: 1;
    min-width: 0;
  }
  .flags-add-value {
    flex: 0 0 110px;
  }
`;
