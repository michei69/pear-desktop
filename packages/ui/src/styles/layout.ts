import { css } from "@pear/sdk/macros" with { type: "macro" };

/** The scrim, the dialog (or the whole window), its header, the restart banner and the body. */
export const layout = css`
  .root {
    position: fixed;
    inset: 0;
    /* Above everything YTM stacks on its page. Not a custom property: lightningcss rounds those to 2147480000. */
    z-index: 2147483000;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: rgb(0 0 0 / 0.62);
    backdrop-filter: blur(3px);
    animation: scrim-in 0.18s ease both;
  }
  .dialog {
    position: relative;
    z-index: 1;
    width: 880px;
    max-width: calc(100vw - 40px);
    height: 592px;
    max-height: calc(100vh - 40px);
    display: flex;
    background: var(--surface-low);
    border-radius: 28px;
    overflow: hidden;
    box-shadow:
      0 24px 64px rgb(0 0 0 / 0.55),
      0 4px 12px rgb(0 0 0 / 0.4);
    animation: pop-in 0.22s cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  /* Exit, matching the entry timing above. The overlay keeps the dialog mounted
     for the animation (see close in index.tsx). */
  .root--closing .scrim {
    animation: scrim-out 0.18s ease both;
  }
  .root--closing .dialog {
    animation: pop-out 0.22s cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  /* ---- standalone window ---- */
  .root--standalone {
    background: var(--surface-low);
  }
  .root--standalone .dialog {
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    border-radius: 0;
    box-shadow: none;
    animation: none;
  }

  /* ---- resize grips ---- */
  /* The dialog's corner grip: no mark, the nwse cursor is the only affordance. */
  .modal-resizer {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 22px;
    height: 22px;
    z-index: 3;
    cursor: nwse-resize;
  }
  /* Straddles the sidebar's border, so the divider itself is the handle. */
  .sidebar-resizer {
    position: absolute;
    top: 0;
    right: -2px;
    bottom: 0;
    width: 5px;
    z-index: 3;
    cursor: col-resize;
  }
  .sidebar-resizer:hover,
  .sidebar-resizer:active {
    background: var(--primary);
    opacity: 0.4;
  }

  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--surface-low);
    /* lets .restart transition height: 0 <-> auto (Chromium 129+) */
    interpolate-size: allow-keywords;
  }
  .header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    height: 60px;
    padding: 0 12px 0 28px;
    border-bottom: 1px solid var(--edge);
  }
  .header-text {
    flex: 1;
    min-width: 0;
  }
  .header-title {
    font-size: 20px;
    font-weight: 500;
  }
  .header-sub {
    font-size: 12px;
    color: var(--on-surface-variant);
  }
  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    color: var(--on-surface-variant);
  }
  .icon-button:hover {
    background: var(--surface-highest);
  }
  .icon {
    flex-shrink: 0;
  }

  /* Alert overlaying the scrolling body: it reserves its own space in the flow
     without shrinking the body's box. Stays mounted and collapses, so showing
     and hiding animates both the fade and the space it takes. */
  .restart {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 12px;
    height: 0;
    margin-bottom: 0;
    padding: 0 12px 0 16px;
    overflow: hidden;
    border-radius: 14px;
    background: var(--tertiary-container);
    color: var(--on-tertiary-container);
    opacity: 0;
    translate: 0 -8px;
    transition:
      height 0.18s ease,
      padding-top 0.18s ease,
      padding-bottom 0.18s ease,
      margin-bottom 0.18s ease,
      opacity 0.18s ease,
      translate 0.18s ease;
  }
  .restart-open {
    height: auto;
    margin-bottom: 14px;
    padding: 12px 12px 12px 16px;
    opacity: 1;
    translate: 0 0;
  }
  .restart-text {
    flex: 1;
    font-size: 13px;
    line-height: 1.35;
  }
  .restart-later,
  .restart-now {
    border-radius: 20px;
    font-size: 13px;
    font-weight: 500;
  }
  .restart-later {
    padding: 8px 10px;
    color: inherit;
    opacity: 0.85;
  }
  .restart-now {
    padding: 8px 16px;
    background: var(--on-tertiary-container);
    color: var(--tertiary-container);
  }

  .body {
    flex: 1;
    padding: 18px 20px 28px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .empty {
    padding: 60px 20px;
    text-align: center;
    color: var(--on-surface-variant);
    font-size: 14px;
  }
`;
