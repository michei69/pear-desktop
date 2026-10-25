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
  // One listener per event per owner (the router keeps one, like Electron), so
  // the CSP strip and the CORS/media handling share this handler.
  webRequest.onHeadersReceived({ urls: ["https://*/*"] }, (details, callback) => {
    const isYtm = URL.parse(details.url)?.origin === YTM_ORIGIN;
    const responseHeaders: Record<string, string[]> = {};
    for (const [name, value] of Object.entries(details.responseHeaders ?? {})) {
      // YTM's CSP (incl. Trusted Types) would block the page runtime and plugin code.
      if (isYtm && STRIPPED_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
      responseHeaders[name] = value;
    }

    // Like pear-desktop: a CORS allowance when a host forgot one, and wildcard
    // CORS for media (podcast/third-party audio), or the renderer's Web Audio
    // graph (equalizer, compressor, crossfade) would stay silent.
    const originKey = headerKey(responseHeaders, "access-control-allow-origin");
    if (details.resourceType === "media") {
      if (originKey) delete responseHeaders[originKey];
      responseHeaders["access-control-allow-origin"] = ["*"];
    } else if (!originKey) {
      responseHeaders["access-control-allow-origin"] = [YTM_ORIGIN];
    }
    callback({ responseHeaders });
  });

  // Covers sign-in XHRs and subresources; the window switches the navigator UA.
  webRequest.onBeforeSendHeaders({ urls: [`${GOOGLE_AUTH_ORIGIN}/*`] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, "User-Agent": electronUserAgent } });
  });
}
