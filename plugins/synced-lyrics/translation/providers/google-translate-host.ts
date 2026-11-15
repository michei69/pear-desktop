/** A bare, usable Google Translate host from a URL, host or empty value. */
export function normalizeGoogleTranslateHost(input?: string) {
  let host = (input || "translate.google.com").trim();
  if (!host) return "translate.google.com";

  try {
    host = new URL(host.includes("://") ? host : `https://${host}`).hostname;
  } catch {
    host = host.split("/")[0] ?? host;
  }

  host = host.replace(/^\.+|\.+$/g, "").toLowerCase();
  if (host.startsWith("www.google.")) return `translate.${host.slice(4)}`;
  if (host.startsWith("google.")) return `translate.${host}`;
  return host || "translate.google.com";
}
