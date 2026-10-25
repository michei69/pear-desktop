// User agents per destination. YTM gets a Chrome UA (Electron's minus
// the Electron/app tokens). Google sign-in gets Electron's own UA: claiming to
// be Chrome (or Firefox) from Chromium is detectable and gets sign-in rejected
// as an insecure browser, while the honest Electron UA is accepted.

/** Electron's default UA advertises Electron and the app name; strip them. */
export function chromeUserAgent(electronUserAgent: string) {
  return electronUserAgent.replace(/ (?!(?:AppleWebKit|Chrome|Safari)\/)[^\s()]+\/[^\s()]+/g, "");
}

/**
 * pear-desktop's fixed Chrome 130 user agents, sent verbatim when
 * `advanced.overrideUserAgent` is on, for sites that treat Electron's UA differently.
 */
export function fixedChromeUserAgent(platform: string) {
  const chrome = "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.152 Safari/537.36";
  if (platform === "darwin") return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${chrome}`;
  if (platform === "win32") return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${chrome}`;
  return `Mozilla/5.0 (X11; Linux x86_64) ${chrome}`;
}

export const GOOGLE_AUTH_ORIGIN = "https://accounts.google.com";
export const YTM_ORIGIN = "https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com";

export function isGoogleAuth(url: string) {
  return URL.parse(url)?.origin === GOOGLE_AUTH_ORIGIN;
}

export function isYtmUrl(url: string) {
  return URL.parse(url)?.origin === YTM_ORIGIN;
}

/** Whether a URL is the standalone settings window (Node's URL gives custom schemes a "null" origin). */
export function isSettingsUrl(url: string) {
  const parsed = URL.parse(url);
  return parsed?.protocol === "pear:" && parsed.host === "settings";
}
