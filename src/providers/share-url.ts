const MUSIC_HOST_PATTERN = /^(https?:\/\/)music\.youtube\.com(?=[:/?#]|$)/i;
// `si` first, followed by another parameter, takes its `&` with it; otherwise it
// takes the `?`/`&` that introduced it.
const SI_PARAM_PATTERN = /\?si=[^&]*&|[?&]si=[^&]*/i;

export const stripMusicSubdomain = (url: string) =>
  url.replace(MUSIC_HOST_PATTERN, '$1youtube.com');

/**
 * Drops the `si` tracking parameter. When `si` led the query the `?` is kept if
 * another parameter follows, so the rest stays a query string instead of
 * collapsing into `watch&v=…`.
 */
export const stripSIParam = (url: string) =>
  url.replace(SI_PARAM_PATTERN, (match) =>
    // The first alternative swallowed the `&` that followed, so the `?` has to
    // stay behind to introduce whatever parameters are left.
    match.endsWith('&') ? '?' : '',
  );

/** Which URL parts to strip; both off means nothing is rewritten. */
export type ShareUrlRewriteOptions = {
  stripMusicFromSharedLinks?: boolean;
  stripSIFromSharedLinks?: boolean;
};

/** The window's config, used when the caller passes no explicit options. */
const optionsFromWindow = (root: Document): ShareUrlRewriteOptions => {
  const config = root.defaultView?.mainConfig;
  return {
    stripMusicFromSharedLinks: Boolean(
      config?.get('options.stripMusicFromSharedLinks'),
    ),
    stripSIFromSharedLinks: Boolean(
      config?.get('options.stripSIFromSharedLinks'),
    ),
  };
};

export const rewriteShareUrlInput = (
  root: Document,
  options: ShareUrlRewriteOptions = optionsFromWindow(root),
) => {
  const input = root.querySelector<HTMLInputElement>('#share-url');
  if (!input) return false;

  let canonicalUrl = input.value;
  if (options.stripMusicFromSharedLinks)
    canonicalUrl = stripMusicSubdomain(canonicalUrl);
  if (options.stripSIFromSharedLinks) canonicalUrl = stripSIParam(canonicalUrl);
  if (canonicalUrl === input.value) return false;

  input.value = canonicalUrl;
  return true;
};

export const createShareUrlRewriter = (
  root: Document = document,
  Observer: typeof MutationObserver = MutationObserver,
  getOptions: () => ShareUrlRewriteOptions = () => optionsFromWindow(root),
) => {
  let observer: MutationObserver | undefined;
  let pendingRewrite: ReturnType<typeof setTimeout> | undefined;

  const rewrite = () => rewriteShareUrlInput(root, getOptions());
  const rewriteBeforeClick = () => rewrite();
  const rewriteAfterChange = () => {
    if (pendingRewrite) clearTimeout(pendingRewrite);
    pendingRewrite = setTimeout(() => {
      pendingRewrite = undefined;
      rewrite();
    }, 0);
  };

  return {
    start() {
      if (!observer) {
        observer = new Observer(rewrite);
        observer.observe(root.documentElement, {
          childList: true,
          subtree: true,
        });
        root.addEventListener('click', rewriteBeforeClick, true);
        root.addEventListener('change', rewriteAfterChange, true);
      }
      // Also rewrites an already-started rewriter, so a newly enabled option
      // applies to the value on screen without waiting for an interaction.
      rewrite();
    },
    stop() {
      observer?.disconnect();
      observer = undefined;
      root.removeEventListener('click', rewriteBeforeClick, true);
      root.removeEventListener('change', rewriteAfterChange, true);

      if (pendingRewrite) {
        clearTimeout(pendingRewrite);
        pendingRewrite = undefined;
      }
    },
  };
};
