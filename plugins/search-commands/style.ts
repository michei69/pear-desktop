/**
 * Spotlight presentation: the search box lifts out of the nav bar into the
 * middle of the screen, over a dimmed page.
 *
 * `ytmusic-nav-bar` is `position: relative` with no `z-index`, so it is not a
 * stacking context — the fixed box below takes part in the root one and clears
 * the scrim regardless of where the nav bar itself sits. The space the box
 * leaves behind is held by `.center-content`, so nothing in the nav bar reflows.
 */
export const SPOTLIGHT_CSS = `
  #pear-spotlight-scrim {
    position: fixed;
    inset: 0;
    z-index: 2147482000;
    display: none;
    background: rgb(0 0 0 / 62%);
    animation: pear-spotlight-fade 140ms ease-out;
  }

  #pear-spotlight-scrim[data-open] {
    display: block;
  }

  @keyframes pear-spotlight-fade {
    from {
      opacity: 0;
    }
  }

  ytmusic-search-box.pear-spotlight {
    position: fixed !important;
    top: var(--pear-spotlight-top, 22vh) !important;
    left: var(--pear-spotlight-left, 50%) !important;
    z-index: 2147482001;
    width: var(--pear-spotlight-width, 680px) !important;
    max-width: none !important;
    animation: pear-spotlight-fade 140ms ease-out;
  }

  ytmusic-search-box.pear-spotlight .search-container {
    border-radius: 10px;
    box-shadow: 0 24px 64px rgb(0 0 0 / 55%);
  }

  /**
   * YTM's suggestion rows have a title slot but no description slot, so this
   * rides along inside the row. margin-left: auto puts it on the right when the
   * row is a flex container; otherwise it wraps below the title.
   */
  ytmusic-search-suggestion .pcmd-desc {
    flex: none;
    margin-left: auto;
    padding-right: 12px;
    font-size: 12px;
    color: var(--yt-spec-text-secondary, #aaa);
    text-overflow: ellipsis;
  }
`;
