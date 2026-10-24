import { Peer } from "peerjs";
import { createPeerOptions } from "./connection.ts";
import {
  buildSummary,
  classifyNat,
  decideVerdict,
  type DiagnosticCheck,
  type DiagnosticResult,
  type GatherResult,
  natStatus,
  parseCandidate,
  selectIceServers,
  type SignalingResult,
} from "./diagnostics-analysis.ts";

/**
 * Music Together connection diagnostics: strict NATs, blocked UDP, an
 * unreachable signaling broker or a downed relay all make host/join fail
 * silently. A throwaway `Peer` tests the signaling broker, and throwaway
 * `RTCPeerConnection`s gather ICE candidates to probe STUN, TURN and the NAT
 * type. The analysis itself lives in `diagnostics-analysis.ts`.
 */

const SIGNALING_TIMEOUT = 8_000;
const STUN_TIMEOUT = 8_000;
const TURN_TIMEOUT = 10_000;

function testSignaling(iceServers: RTCIceServer[], signal: AbortSignal): Promise<SignalingResult> {
  const { promise, resolve } = Promise.withResolvers<SignalingResult>();
  if (signal.aborted) {
    resolve({ ok: false, error: "cancelled" });
    return promise;
  }
  let settled = false;
  let peer: Peer;
  try {
    peer = new Peer(createPeerOptions(iceServers));
  } catch (error) {
    resolve({ ok: false, error: String(error) });
    return promise;
  }

  const finish = (result: SignalingResult) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    try {
      if (!peer.destroyed) peer.destroy();
    } catch {
      // Already gone.
    }
    resolve(result);
  };
  const timer = setTimeout(() => finish({ ok: false, error: "timeout" }), SIGNALING_TIMEOUT);
  const onAbort = () => finish({ ok: false, error: "cancelled" });
  signal.addEventListener("abort", onAbort, { once: true });

  peer.on("open", () => finish({ ok: true }));
  peer.on("error", (error) => finish({ ok: false, error: error.type }));
  return promise;
}

function gatherCandidates(
  iceServers: RTCIceServer[],
  timeout: number,
  policy: RTCIceTransportPolicy,
  signal: AbortSignal,
): Promise<GatherResult> {
  const { promise, resolve } = Promise.withResolvers<GatherResult>();
  const result: GatherResult = {
    hasHost: false,
    hasSrflx: false,
    hasRelay: false,
    srflx: [],
    srflxServers: new Set<string>(),
  };
  if (signal.aborted) {
    resolve({ ...result, error: "cancelled" });
    return promise;
  }

  let connection: RTCPeerConnection;
  try {
    connection = new RTCPeerConnection({ iceServers, iceTransportPolicy: policy });
  } catch (error) {
    resolve({ ...result, error: String(error) });
    return promise;
  }

  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    try {
      connection.close();
    } catch {
      // Already closed.
    }
    resolve(result);
  };
  const timer = setTimeout(finish, timeout);
  const onAbort = () => {
    result.error ??= "cancelled";
    finish();
  };
  signal.addEventListener("abort", onAbort, { once: true });

  connection.onicecandidate = (event) => {
    const candidate = event.candidate;
    if (!candidate || !candidate.candidate) {
      finish(); // null candidate: gathering complete
      return;
    }

    const parsed = parseCandidate(candidate.candidate);
    const type = candidate.type ?? parsed.type;
    const address = candidate.address ?? parsed.address;
    const port = candidate.port ?? parsed.port;
    const relatedPort = candidate.relatedPort ?? parsed.relatedPort ?? 0;

    if (type === "host") result.hasHost = true;
    if (type === "relay") result.hasRelay = true;
    if (type === "srflx") {
      result.hasSrflx = true;
      if (address) result.publicIp = address;
      // `url` (the server that produced this candidate) is populated by
      // Chromium but missing from the DOM typings.
      const url = (event as RTCPeerConnectionIceEvent & { url?: string | null }).url;
      if (url) result.srflxServers.add(url);
      result.srflx.push({ relatedPort, publicPort: port ?? 0, publicIp: address ?? "" });
    }
  };

  connection.onicegatheringstatechange = () => {
    if (connection.iceGatheringState === "complete") finish();
  };

  try {
    connection.createDataChannel("music-together-diagnostics");
    connection
      .createOffer()
      .then((offer) => connection.setLocalDescription(offer))
      .catch((error: unknown) => {
        result.error = String(error);
        finish();
      });
  } catch (error) {
    result.error = String(error);
    finish();
  }
  return promise;
}

/**
 * Run all connection checks. `onUpdate` fires as each individual check
 * resolves so the UI can fill rows progressively; the returned promise
 * resolves once every check is done with the aggregated result.
 */
export async function runDiagnostics(
  iceServers: RTCIceServer[],
  onUpdate?: (check: DiagnosticCheck) => void,
  signal?: AbortSignal,
): Promise<DiagnosticResult> {
  const { stun: stunServers, turn: turnServers } = selectIceServers(iceServers);
  const checks: DiagnosticCheck[] = [];
  const emit = (check: DiagnosticCheck) => {
    checks.push(check);
    if (!signal?.aborted) onUpdate?.(check);
  };
  const abortSignal = signal ?? new AbortController().signal;

  const signalingPromise = testSignaling(iceServers, abortSignal).then((result) => {
    emit({
      id: "signaling",
      status: result.ok ? "pass" : "fail",
      detail: result.ok ? undefined : result.error,
    });
    return result;
  });

  const stunPromise = gatherCandidates(stunServers, STUN_TIMEOUT, "all", abortSignal).then((result) => {
    emit({
      id: "stun",
      status: result.error ? "fail" : result.hasSrflx ? "pass" : "warn",
      detail: result.error ?? result.publicIp,
    });
    return result;
  });

  const turnPromise = gatherCandidates(turnServers, TURN_TIMEOUT, "relay", abortSignal).then((result) => {
    emit({
      id: "turn",
      status: result.error ? "fail" : result.hasRelay ? "pass" : "warn",
      detail: result.error,
    });
    return result;
  });

  const [signaling, stun, turn] = await Promise.all([signalingPromise, stunPromise, turnPromise]);

  const natType = classifyNat(stun);
  emit({ id: "nat", status: natStatus(natType), detail: natType });

  const verdict = decideVerdict(signaling, stun, turn, natType);

  return {
    checks,
    natType,
    verdict,
    publicIp: stun.publicIp,
    summary: buildSummary(signaling, stun, turn, natType, verdict),
  };
}
