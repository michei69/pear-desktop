/**
 * Pure analysis of the connection diagnostics: no WebRTC or DOM access here,
 * so the heuristics stay testable apart from `diagnostics.ts`.
 */

export type CheckStatus = "pass" | "warn" | "fail";
export type CheckId = "signaling" | "stun" | "turn" | "nat";

export interface DiagnosticCheck {
  id: CheckId;
  status: CheckStatus;
  /** Non-translatable specifics (public IP, NAT label, error code). */
  detail?: string | undefined;
}

export type NatType = "open" | "symmetric" | "blocked" | "unknown";
export type Verdict = "good" | "relay" | "blocked" | "limited" | "no-signaling";

export interface DiagnosticResult {
  checks: DiagnosticCheck[];
  natType: NatType;
  verdict: Verdict;
  publicIp?: string | undefined;
  /** Plain-text, copyable technical summary for bug reports. */
  summary: string;
}

export interface SignalingResult {
  ok: boolean;
  error?: string | undefined;
}

export interface SrflxMapping {
  relatedPort: number;
  publicPort: number;
  publicIp: string;
}

export interface GatherResult {
  hasHost: boolean;
  hasSrflx: boolean;
  hasRelay: boolean;
  srflx: SrflxMapping[];
  /** Distinct STUN server URLs that produced a reflexive candidate. */
  srflxServers: Set<string>;
  publicIp?: string | undefined;
  error?: string | undefined;
}

const urlsOf = (server: RTCIceServer): string[] => (Array.isArray(server.urls) ? server.urls : [server.urls]);

/** Splits the configured ICE servers into the groups the checks use. */
export const selectIceServers = (iceServers: RTCIceServer[]) => ({
  stun: iceServers.filter((server) => urlsOf(server).some((url) => url.startsWith("stun:"))),
  turn: iceServers.filter((server) => urlsOf(server).some((url) => url.startsWith("turn:") || url.startsWith("turns:"))),
});

/**
 * Fallback parser for the raw candidate string, used when the structured
 * `RTCIceCandidate` fields are unavailable.
 *
 * `candidate:<foundation> <component> <transport> <priority> <address> <port>
 *  typ <type> [raddr <relatedAddr> rport <relatedPort> ...]`
 */
export const parseCandidate = (candidate: string) => {
  const parts = candidate.split(" ");
  const typeIndex = parts.indexOf("typ");
  const relatedPortIndex = parts.indexOf("rport");
  return {
    address: parts[4],
    port: Number(parts[5]),
    type: typeIndex >= 0 ? parts[typeIndex + 1] : undefined,
    relatedPort: relatedPortIndex >= 0 ? Number(parts[relatedPortIndex + 1]) : 0,
  };
};

/**
 * Two-server NAT heuristic: if the same local port is reflected with different
 * public ports the NAT is symmetric (direct P2P fails, a relay is required);
 * if it stays the same it is a cone. A cone is only reported once two
 * independent STUN servers replied — one reply cannot rule out a symmetric NAT,
 * so it stays "unknown" rather than falsely reassuring.
 */
export const classifyNat = (stun: GatherResult): NatType => {
  if (!stun.hasSrflx) {
    // No reflexive candidate at all: UDP or STUN is blocked on this network.
    return stun.hasHost ? "blocked" : "unknown";
  }

  const byLocalPort = new Map<number, Set<number>>();
  for (const mapping of stun.srflx) {
    const ports = byLocalPort.get(mapping.relatedPort) ?? new Set<number>();
    ports.add(mapping.publicPort);
    byLocalPort.set(mapping.relatedPort, ports);
  }

  const isSymmetric = Array.from(byLocalPort.values()).some((ports) => ports.size > 1);
  if (isSymmetric) return "symmetric";

  // Not symmetric, but only trust "open" once two independent STUN servers
  // have actually replied; otherwise we never verified the mapping.
  return stun.srflxServers.size >= 2 ? "open" : "unknown";
};

export const natStatus = (natType: NatType): CheckStatus => {
  if (natType === "open") return "pass";
  if (natType === "blocked") return "fail";
  return "warn";
};

export const decideVerdict = (signaling: SignalingResult, stun: GatherResult, turn: GatherResult, natType: NatType): Verdict => {
  if (!signaling.ok) return "no-signaling";
  // A symmetric or missing reflexive candidate means direct P2P will not work.
  if (!stun.hasSrflx || natType === "symmetric") {
    return turn.hasRelay ? "relay" : "blocked";
  }
  // Reflexive candidates work, so direct connections likely do too; without
  // two confirming servers the NAT type stays undetermined rather than failed.
  return natType === "open" ? "good" : "limited";
};

export const buildSummary = (
  signaling: SignalingResult,
  stun: GatherResult,
  turn: GatherResult,
  natType: NatType,
  verdict: Verdict,
): string => {
  const yes = (ok: boolean) => (ok ? "ok" : "fail");
  const errorOf = (result: GatherResult) => (result.error ? ` (${result.error})` : "");
  return [
    "Music Together connection diagnostics",
    `- signaling broker: ${yes(signaling.ok)}${signaling.error ? ` (${signaling.error})` : ""}`,
    `- STUN (direct): ${yes(stun.hasSrflx)}${errorOf(stun)}${stun.publicIp ? ` (public ${stun.publicIp})` : ""}`,
    `- TURN (relay): ${yes(turn.hasRelay)}${errorOf(turn)}`,
    `- NAT type: ${natType}`,
    `- verdict: ${verdict}`,
  ].join("\n");
};
