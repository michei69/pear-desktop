// Where links and navigations of the main window go: YTM, its video site and
// Google stay in the app, other web pages open in the browser, mail and
// telephone links go to the system handler, anything else nowhere.
// Pure, so it needs no Electron (unit tests).

import { GOOGLE_AUTH_ORIGIN, YTM_ORIGIN } from "../shared/user-agent.ts";

/** The video site YTM belongs to (its sign-in redirects and consent page live there). */
const VIDEO_SITE = new URL(YTM_ORIGIN).hostname.replace(/^music\./, "");

/** Origins the sign-in, consent and sign-out flows pass through on their way back to YTM. */
const AUTH_ORIGINS = new Set([
  GOOGLE_AUTH_ORIGIN,
  `https://accounts.${VIDEO_SITE}`,
  "https://consent.google.com",
  `https://consent.${VIDEO_SITE}`,
  // Account checkups ("protect your account") Google shows during sign-in.
  "https://gds.google.com",
]);

/** The video site's own pages that only hand the session over to YTM. */
const VIDEO_SITE_ORIGIN = `https://www.${VIDEO_SITE}`;
const AUTH_PATHS = new Set(["/signin", "/logout"]);

/** Sites that stay in the app when a page links to them (OAuth, help, channel pages). */
const IN_APP_DOMAINS = ["\u0079outube.com", "youtu.be", "google.com"];

/** Schemes the system browser or handler owns. */
const EXTERNAL_SCHEMES = new Set(["mailto:", "tel:"]);

export type WindowOpenAction = "load" | "popup" | "external" | "deny";
export type NavigationAction = "allow" | "external" | "deny";

function isWeb(url: URL) {
  return url.protocol === "https:" || url.protocol === "http:";
}

function isAuthFlow(url: URL) {
  if (AUTH_ORIGINS.has(url.origin)) return true;
  return url.origin === VIDEO_SITE_ORIGIN && AUTH_PATHS.has(url.pathname);
}

/** Whether a host is one of the sites that stay in the app. */
function isInApp(hostname: string) {
  return IN_APP_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

/** A new window the page asked for (target=_blank, middle or Ctrl+click, window.open). */
export function windowOpenAction(url: string): WindowOpenAction {
  const parsed = URL.parse(url);
  if (!parsed) return "deny";
  if (EXTERNAL_SCHEMES.has(parsed.protocol)) return "external";
  // OAuth popups start blank and navigate to the sign-in flow.
  if (parsed.protocol === "about:" && parsed.pathname === "blank") return "popup";
  if (!isWeb(parsed)) return "deny";
  if (parsed.origin === YTM_ORIGIN) return "load";
  if (parsed.protocol === "https:" && isInApp(parsed.hostname)) return "popup";
  return "external";
}

/** A navigation the main window's page started (links, location changes, form posts). */
export function navigationAction(url: string): NavigationAction {
  const parsed = URL.parse(url);
  if (!parsed) return "deny";
  if (EXTERNAL_SCHEMES.has(parsed.protocol)) return "external";
  if (!isWeb(parsed)) return "deny";
  if (parsed.origin === YTM_ORIGIN || isAuthFlow(parsed)) return "allow";
  // Keep the video site and Google in the app, but never downgrade them to http.
  if (parsed.protocol === "https:" && isInApp(parsed.hostname)) return "allow";
  return "external";
}
