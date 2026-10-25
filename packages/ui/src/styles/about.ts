import { css } from "@pear/sdk/macros" with { type: "macro" };

/** The About section: the logo, version cards, links, actions and copyright. */
export const about = css`
  .about {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .about-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 4px;
    padding: 8px 0 12px;
  }
  .about-header img {
    display: block;
    margin-bottom: 8px;
  }
  .about-name {
    font-size: 22px;
    font-weight: 600;
    color: var(--on-surface);
  }
  .about-version {
    font-size: 13px;
    color: var(--on-surface-variant);
  }
  .about-tagline {
    max-width: 420px;
    font-size: 13px;
    color: var(--on-surface-variant);
  }
  .about-card {
    padding: 16px 18px;
  }
  .about .card + .card {
    margin-top: 0;
  }
  .about-section-title {
    margin-bottom: 12px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--on-surface-variant);
  }
  .about-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
  }
  .about-grid-row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    font-size: 13px;
  }
  .about-grid-row dt {
    color: var(--on-surface-variant);
  }
  .about-grid-row dd {
    margin: 0;
    color: var(--on-surface);
    font-variant-numeric: tabular-nums;
  }
  .about-links {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .about-link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .about-copyright {
    white-space: pre-line;
    text-align: center;
    font-size: 12px;
    line-height: 1.6;
    color: var(--on-surface-variant);
  }

  /* The update settings read as the same cards as Links and Actions. */
  .about > .group {
    margin-bottom: 0;
  }
  .about > .group > .card {
    padding: 16px 18px;
    border-radius: 18px;
  }
  .about > .group > .card > .field {
    padding: 12px 0;
  }
  .about > .group > .card > .field:first-child {
    padding-top: 0;
  }
  .about > .group > .card > .field:last-child {
    padding-bottom: 0;
  }
  .about > .group .group-title {
    margin: 0 0 12px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--on-surface-variant);
  }
`;
