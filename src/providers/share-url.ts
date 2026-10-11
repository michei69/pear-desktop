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

export const rewriteShareUrlInput = (root: Document) => {
  const input = root.querySelector<HTMLInputElement>('#share-url');
  if (!input) return false;

  // The preload puts the config on the window this document belongs to.
  const config = root.defaultView?.mainConfig;
  let canonicalUrl = input.value;
  if (config?.get('options.stripMusicFromSharedLinks'))
    canonicalUrl = stripMusicSubdomain(canonicalUrl);
  if (config?.get('options.stripSIFromSharedLinks'))
    canonicalUrl = stripSIParam(canonicalUrl);
  if (canonicalUrl === input.value) return false;

  input.value = canonicalUrl;
  return true;
};

export const createShareUrlRewriter = (
  root: Document = document,
  Observer: typeof MutationObserver = MutationObserver,
) => {
  let observer: MutationObserver | undefined;
  let pendingRewrite: ReturnType<typeof setTimeout> | undefined;

  const rewrite = () => rewriteShareUrlInput(root);
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
      if (observer) return;

      observer = new Observer(rewrite);
      observer.observe(root.documentElement, {
        childList: true,
        subtree: true,
      });
      root.addEventListener('click', rewriteBeforeClick, true);
      root.addEventListener('change', rewriteAfterChange, true);
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
