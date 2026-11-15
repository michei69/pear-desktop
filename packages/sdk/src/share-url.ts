// Cleaning the links YTM's share dialog puts on the clipboard: drop the
// `music.` subdomain and YTM's `si` tracking parameter.

const MUSIC_HOST_PATTERN = /^(https?:\/\/)music\.\u0079outube\.com(?=[:/?#]|$)/i;
// `si` first, followed by another parameter, takes its `&` with it; otherwise it
// takes the `?`/`&` that introduced it.
const SI_PARAM_PATTERN = /\?si=[^&]*&|[?&]si=[^&]*/i;

export const stripMusicSubdomain = (url: string) => url.replace(MUSIC_HOST_PATTERN, "$1\u0079outube.com");

/**
 * Drops the `si` tracking parameter. When `si` led the query the `?` is kept if
 * another parameter follows, so the rest stays a query string instead of
 * collapsing into `watch&v=…`.
 */
export const stripSIParam = (url: string) =>
  url.replace(SI_PARAM_PATTERN, (match) =>
    // The first alternative swallowed the `&` that followed, so the `?` has to
    // stay behind to introduce whatever parameters are left.
    match.endsWith("&") ? "?" : "",
  );

export interface ShareUrlOptions {
  /** Drop the `music.` subdomain. */
  stripMusic: boolean;
  /** Drop the `si` tracking parameter. */
  stripSI: boolean;
}

/** Rewrites the share dialog's URL input, if it is open. Returns whether it changed. */
export function rewriteShareUrlInput(root: Document, options: ShareUrlOptions) {
  const input = root.querySelector<HTMLInputElement>("#share-url");
  if (!input) return false;

  let canonicalUrl = input.value;
  if (options.stripMusic) canonicalUrl = stripMusicSubdomain(canonicalUrl);
  if (options.stripSI) canonicalUrl = stripSIParam(canonicalUrl);
  if (canonicalUrl === input.value) return false;

  input.value = canonicalUrl;
  return true;
}

/** Rewatches the share dialog as YTM re-renders it; `stop` removes everything. */
export function createShareUrlRewriter(root: Document, options: ShareUrlOptions, Observer: typeof MutationObserver = MutationObserver) {
  let observer: MutationObserver | undefined;
  let pendingRewrite: ReturnType<typeof setTimeout> | undefined;

  const rewrite = () => rewriteShareUrlInput(root, options);
  const rewriteBeforeClick = () => rewrite();
  const rewriteAfterChange = () => {
    clearTimeout(pendingRewrite);
    pendingRewrite = setTimeout(() => {
      pendingRewrite = undefined;
      rewrite();
    }, 0);
  };

  return {
    start() {
      if (observer) return;

      observer = new Observer(rewrite);
      observer.observe(root.documentElement, { childList: true, subtree: true });
      root.addEventListener("click", rewriteBeforeClick, true);
      root.addEventListener("change", rewriteAfterChange, true);
      rewrite();
    },
    stop() {
      observer?.disconnect();
      observer = undefined;
      root.removeEventListener("click", rewriteBeforeClick, true);
      root.removeEventListener("change", rewriteAfterChange, true);

      if (pendingRewrite) {
        clearTimeout(pendingRewrite);
        pendingRewrite = undefined;
      }
    },
  };
}
