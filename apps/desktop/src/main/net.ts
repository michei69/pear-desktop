// Core request rewriting, registered through the webRequest router so plugins
// (ad blockers, proxies) compose with it.

import type { WebRequest } from "electron";
import { GOOGLE_AUTH_ORIGIN, YTM_ORIGIN } from "../shared/user-agent.ts";

const STRIPPED_RESPONSE_HEADERS = new Set(["content-security-policy", "content-security-policy-report-only"]);

/** The key `headers` holds for `name`, whatever its case. */
const headerKey = (headers: Record<string, string[]>, name: string) => Object.keys(headers).find((key) => key.toLowerCase() === name);

export interface NetOptions {
  /** Electron's unmodified UA, sent to Google sign-in. */
  electronUserAgent: string;
}

export function setupNet(webRequest: WebRequest, { electronUserAgent }: NetOptions) {
  // As pear-desktop, on every https response: no CSP (YTM's, incl. Trusted Types,
  // would block the page runtime and plugin code; others would block what plugins
  // load or embed), and YTM may read it (plugins fetch from other sites in the page).
  webRequest.onHeadersReceived({ urls: ["https://*/*"] }, (details, callback) => {
    callback({ responseHeaders: rewriteResponseHeaders(details.responseHeaders ?? {}, details.resourceType) });
  });

  // Covers sign-in XHRs and subresources; the window switches the navigator UA.
  webRequest.onBeforeSendHeaders({ urls: [`${GOOGLE_AUTH_ORIGIN}/*`] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, "User-Agent": electronUserAgent } });
  });
}

/**
 * A response's headers without CSP, and readable by YTM's page when no CORS header says otherwise.
 * Media is readable by everyone: crossfade, the equalizer and the compressor pull buffered audio
 * through Web Audio, which stays silent without a wildcard origin.
 */
export function rewriteResponseHeaders(
  headers: Record<string, string[]>,
  resourceType?: string,
): Record<string, string[]> {
  const rewritten: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!STRIPPED_RESPONSE_HEADERS.has(name.toLowerCase())) rewritten[name] = value;
  }
  const originKey = Object.keys(rewritten).find((name) => name.toLowerCase() === "access-control-allow-origin");
  if (resourceType === "media") {
    if (originKey !== undefined) delete rewritten[originKey];
    rewritten["access-control-allow-origin"] = ["*"];
  } else if (originKey === undefined) {
    rewritten["access-control-allow-origin"] = [YTM_ORIGIN];
  }
  return rewritten;
}
