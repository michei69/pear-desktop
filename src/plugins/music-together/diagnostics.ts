import { Peer } from 'peerjs';

import { ICE_SERVERS, peerOptions } from './connection';
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
} from './diagnostics-analysis';

/**
 * Music Together connection diagnostics: strict NATs, blocked UDP, an
 * unreachable signaling broker or a downed relay all make host/join fail
 * silently. A throwaway {@link Peer} tests the signaling broker, and throwaway
 * {@link RTCPeerConnection}s gather ICE candidates to probe STUN, TURN and the
 * NAT type. The analysis itself lives in `diagnostics-analysis.ts`.
 */

const { stun: STUN_SERVERS, turn: TURN_SERVERS } =
  selectIceServers(ICE_SERVERS);

const SIGNALING_TIMEOUT = 8_000;
const STUN_TIMEOUT = 8_000;
const TURN_TIMEOUT = 10_000;

const testSignaling = (timeout = SIGNALING_TIMEOUT): Promise<SignalingResult> =>
  new Promise((resolve) => {
    let settled = false;
    let peer: Peer;
    try {
      peer = new Peer(peerOptions());
    } catch (err) {
      resolve({ ok: false, error: String(err) });
      return;
    }

    const finish = (result: SignalingResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (!peer.destroyed) peer.destroy();
      } catch {
        // ignore
      }
      resolve(result);
    };

    const timer = setTimeout(
      () => finish({ ok: false, error: 'timeout' }),
      timeout,
    );

    peer.on('open', () => finish({ ok: true }));
    peer.on('error', (err) => finish({ ok: false, error: err.type }));
  });

const gatherCandidates = (
  iceServers: RTCIceServer[],
  timeout: number,
  policy: RTCIceTransportPolicy = 'all',
): Promise<GatherResult> =>
  new Promise((resolve) => {
    const result: GatherResult = {
      hasHost: false,
      hasSrflx: false,
      hasRelay: false,
      srflx: [],
      srflxServers: new Set<string>(),
    };

    let pc: RTCPeerConnection;
    try {
      pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: policy });
    } catch (err) {
      resolve({ ...result, error: String(err) });
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        pc.close();
      } catch {
        // ignore
      }
      resolve(result);
    };
    const timer = setTimeout(finish, timeout);

    pc.onicecandidate = (event) => {
      const candidate = event.candidate;
      if (!candidate || !candidate.candidate) {
        finish(); // null candidate => gathering complete
        return;
      }

      const parsed = parseCandidate(candidate.candidate);
      const type = candidate.type ?? parsed.type;
      const address = candidate.address ?? parsed.address;
      const port = candidate.port ?? parsed.port;
      const relatedPort = candidate.relatedPort ?? parsed.relatedPort ?? 0;

      if (type === 'host') result.hasHost = true;
      if (type === 'relay') result.hasRelay = true;
      if (type === 'srflx') {
        result.hasSrflx = true;
        if (address) result.publicIp = address;
        // `url` (the server that produced this candidate) is populated by
        // Chromium but missing from the DOM typings.
        const url = (
          event as RTCPeerConnectionIceEvent & { url?: string | null }
        ).url;
        if (url) result.srflxServers.add(url);
        result.srflx.push({
          relatedPort,
          publicPort: port ?? 0,
          publicIp: address ?? '',
        });
      }
    };

    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };

    try {
      pc.createDataChannel('music-together-diagnostics');
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch((err) => {
          result.error = String(err);
          finish();
        });
    } catch (err) {
      result.error = String(err);
      finish();
    }
  });

/**
 * Run all connection checks. `onUpdate` fires as each individual check resolves
 * so the UI can fill rows progressively; the returned promise resolves once
 * every check is done with the aggregated result.
 */
export const runDiagnostics = async (
  onUpdate?: (check: DiagnosticCheck) => void,
): Promise<DiagnosticResult> => {
  const checks: DiagnosticCheck[] = [];
  const emit = (check: DiagnosticCheck) => {
    checks.push(check);
    onUpdate?.(check);
  };

  const signalingP = testSignaling().then((result) => {
    emit({
      id: 'signaling',
      status: result.ok ? 'pass' : 'fail',
      detail: result.ok ? undefined : result.error,
    });
    return result;
  });

  const stunP = gatherCandidates(STUN_SERVERS, STUN_TIMEOUT).then((result) => {
    emit({
      id: 'stun',
      status: result.error ? 'fail' : result.hasSrflx ? 'pass' : 'warn',
      detail: result.error ?? result.publicIp,
    });
    return result;
  });

  const turnP = gatherCandidates(TURN_SERVERS, TURN_TIMEOUT, 'relay').then(
    (result) => {
      emit({
        id: 'turn',
        status: result.error ? 'fail' : result.hasRelay ? 'pass' : 'warn',
        detail: result.error,
      });
      return result;
    },
  );

  const [signaling, stun, turn] = await Promise.all([signalingP, stunP, turnP]);

  const natType = classifyNat(stun);
  emit({ id: 'nat', status: natStatus(natType), detail: natType });

  const verdict = decideVerdict(signaling, stun, turn, natType);

  return {
    checks,
    natType,
    verdict,
    publicIp: stun.publicIp,
    summary: buildSummary(signaling, stun, turn, natType, verdict),
  };
};
