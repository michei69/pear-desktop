import { css } from "@pear/sdk/macros" with { type: "macro" };

/** Title, search, the sections and the version line. */
export const sidebar = css`
  .sidebar {
    position: relative;
    width: 244px;
    min-width: 180px;
    max-width: 420px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-right: 1px solid var(--edge);
  }
  .sidebar-head {
    padding: 22px 20px 14px;
  }
  .sidebar-title {
    font-size: 22px;
    line-height: 28px;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 48px;
    margin: 0 14px 10px;
    padding: 0 16px;
    border-radius: 24px;
    background: var(--surface-high);
    color: var(--on-surface-variant);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    font-size: 15px;
    color: var(--on-surface);
  }
  .search input::-webkit-search-cancel-button {
    filter: invert(0.8);
  }
  .nav {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 12px 14px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    height: 42px;
    padding: 0 16px;
    border-radius: 21px;
    color: var(--on-surface-variant);
    font-size: 14px;
    font-weight: 500;
    text-align: left;
  }
  .nav-item:hover {
    background: var(--surface-high);
  }
  .nav-item[aria-current="page"] {
    background: var(--secondary-container);
    color: var(--on-secondary-container);
  }
  .nav-label {
    flex: 1;
  }
  .nav-count {
    font-size: 11px;
    font-weight: 500;
    opacity: 0.8;
  }
  .sidebar-foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 20px;
    border-top: 1px solid var(--edge);
    font-size: 11px;
    color: var(--on-surface-variant);
  }
  /* The version doubles as a "copy debug info" button, like pear-desktop's. */
  .sidebar-version {
    padding: 0;
    color: inherit;
    font-size: 11px;
  }
  .sidebar-version:hover {
    color: var(--on-surface);
  }
  .link-button {
    padding: 0;
    color: var(--primary);
    font-size: 11px;
  }
  .link-button:hover {
    text-decoration: underline;
  }
`;
