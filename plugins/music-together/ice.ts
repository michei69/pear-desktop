// The STUN/TURN servers a session may use. Shared by the Peer options and the
// connection diagnostics, and configurable because the free public relays
// come and go (the relays PeerJS used to run were decommissioned).

/** One URL, optionally followed by `|username|credential` for TURN. */
export const DEFAULT_ICE_ENTRIES: readonly string[] = [
  // Two STUN servers, so the NAT check can compare their reflexive mappings.
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
  "stun:stun.cloudflare.com:3478",
  "stun:freestun.net:3478",
  "turn:freestun.net:3478|free|free",
  // Open Relay Project (Metered); the TCP/443 entry tunnels through firewalls.
  "turn:openrelay.metered.ca:80|openrelayproject|openrelayproject",
  "turn:openrelay.metered.ca:443|openrelayproject|openrelayproject",
  "turn:openrelay.metered.ca:443?transport=tcp|openrelayproject|openrelayproject",
];

const ICE_URL = /^(stuns?|turns?):/i;

/**
 * Parses config entries into WebRTC servers. Lines that are not STUN/TURN URLs
 * are skipped, so one mistake does not make a session impossible.
 */
export function parseIceServers(entries: readonly string[]): RTCIceServer[] {
  const servers: RTCIceServer[] = [];
  for (const entry of entries) {
    const [rawUrl, username, credential] = entry.split("|").map((part) => part.trim());
    if (!rawUrl || !ICE_URL.test(rawUrl)) continue;
    const isTurn = /^turns?:/i.test(rawUrl);
    servers.push(isTurn && username && credential !== undefined ? { urls: rawUrl, username, credential } : { urls: rawUrl });
  }
  return servers;
}
