/**
 * Where a link clicked inside the app should go: YouTube (Music) and Google are
 * the app's own pages and stay in the window, as does whatever host `options.url`
 * points at, so a custom front-end keeps navigating internally. Everything else
 * belongs to the user's browser.
 */

/** Hosts kept in the app, subdomains included. */
const IN_APP_DOMAINS = ['youtube.com', 'youtu.be', 'google.com'];

export type LinkTarget = 'in-app' | 'external' | 'blocked';

const matchesDomain = (hostname: string, domain: string) =>
  hostname === domain || hostname.endsWith(`.${domain}`);

export const classifyLink = (target: string, appUrl: string): LinkTarget => {
  const url = URL.parse(target);
  if (!url) return 'blocked';

  // Empty windows are how some sign-in flows take a popup before filling it.
  if (url.protocol === 'about:') return 'in-app';

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    const appHostname = URL.parse(appUrl)?.hostname;
    const inApp =
      IN_APP_DOMAINS.some((domain) => matchesDomain(url.hostname, domain)) ||
      (appHostname !== undefined && matchesDomain(url.hostname, appHostname));

    return inApp ? 'in-app' : 'external';
  }

  // `file:` is the app's own: the offline error page and popups are loaded
  // from code, which these events never see, and no link gets to open one.
  // The OS owns `mailto:`/`tel:`; `javascript:` and `data:` are dropped.
  return url.protocol === 'mailto:' || url.protocol === 'tel:'
    ? 'external'
    : 'blocked';
};
