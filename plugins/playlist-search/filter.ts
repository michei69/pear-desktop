// The playlist row filter, out of the DOM code so its matching and restore
// behavior can be tested without YTM's renderers.

/** The part of a row the filter touches: its inline display. */
export interface FilterRow {
  readonly style: { display: string };
}

/** Whether a row title contains the search term (already lowercased and trimmed). */
export function matchesTitle(title: string, term: string): boolean {
  return term.length === 0 || title.toLowerCase().includes(term);
}

/** Hides the rows that don't match; returns how many stay visible. */
export function filterRows<R extends FilterRow>(rows: Iterable<R>, term: string, title: (row: R) => string): number {
  let visible = 0;
  for (const row of rows) {
    const matches = matchesTitle(title(row), term);
    row.style.display = matches ? "" : "none";
    if (matches) visible++;
  }
  return visible;
}

/**
 * Whether a pass has anything to do. Rows are visible by default, so with an
 * empty box and no filter applied there is nothing to restore; the passes
 * scheduled on YTM's DOM churn (up to one per 50 ms) stay O(1) instead of
 * re-reading every row.
 */
export function needsApply(term: string, filtering: boolean): boolean {
  return term.length > 0 || filtering;
}
