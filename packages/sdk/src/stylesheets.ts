// Constructed style sheets, and the order of the document's adopted ones:
// everything else first, then the theme sheets (a theme's CSS, its palette and
// a theme script's own palette), so themes win ties.
// The page runtime's; plugins add theirs with `ctx.addStyle`.

/** A constructed style sheet holding `css`. */
export function styleSheet(css: string): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  return sheet;
}

let themeSheets: readonly CSSStyleSheet[] = [];

/** Adopts `sheet` into the document, before the theme sheets. */
export function adoptSheet(sheet: CSSStyleSheet) {
  const others = document.adoptedStyleSheets.filter((s) => !themeSheets.includes(s));
  document.adoptedStyleSheets = [...others, sheet, ...themeSheets];
}

export function dropSheets(sheets: Iterable<CSSStyleSheet>) {
  const dropped = new Set(sheets);
  document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => !dropped.has(s));
  themeSheets = themeSheets.filter((s) => !dropped.has(s));
}

/** Replaces the trailing theme sheets, in cascade order. */
export function setThemeSheets(sheets: readonly CSSStyleSheet[]) {
  const others = document.adoptedStyleSheets.filter((s) => !themeSheets.includes(s));
  themeSheets = sheets;
  document.adoptedStyleSheets = [...others, ...sheets];
}
