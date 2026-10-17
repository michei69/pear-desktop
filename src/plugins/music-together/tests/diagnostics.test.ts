import { test, expect } from '@playwright/test';

import {
  buildSummary,
  classifyNat,
  decideVerdict,
  type GatherResult,
  natStatus,
  parseCandidate,
  selectIceServers,
  type SignalingResult,
} from '../diagnostics-analysis';

const gather = (overrides: Partial<GatherResult> = {}): GatherResult => ({
  hasHost: true,
  hasSrflx: true,
  hasRelay: false,
  srflx: [],
  srflxServers: new Set(),
  ...overrides,
});

const mapping = (
  relatedPort: number,
  publicPort: number,
): GatherResult['srflx'][number] => ({
  relatedPort,
  publicPort,
  publicIp: '203.0.113.1',
});

const signaling = (ok: boolean): SignalingResult => ({ ok });

test('parses the RFC 5245 candidate fields', () => {
  expect(
    parseCandidate(
      'candidate:1 1 UDP 2122252543 192.0.2.1 5000 typ srflx raddr 10.0.0.2 rport 6000',
    ),
  ).toEqual({
    address: '192.0.2.1',
    port: 5000,
    type: 'srflx',
    relatedPort: 6000,
  });
});

test('parses a candidate without a related address', () => {
  expect(
    parseCandidate('candidate:2 1 UDP 2122252543 192.0.2.2 5001 typ host'),
  ).toEqual({
    address: '192.0.2.2',
    port: 5001,
    type: 'host',
    relatedPort: 0,
  });
});

test('treats a host candidate with no reflexive reply as a blocked NAT', () => {
  expect(classifyNat(gather({ hasSrflx: false }))).toBe('blocked');
});

test('does not claim a blocked NAT when even host candidates are missing', () => {
  expect(classifyNat(gather({ hasHost: false, hasSrflx: false }))).toBe(
    'unknown',
  );
});

test('detects a symmetric NAT when one local port maps to several public ports', () => {
  const result = gather({
    srflx: [mapping(5000, 1000), mapping(5000, 2000)],
    srflxServers: new Set(['stun:a', 'stun:b']),
  });
  expect(classifyNat(result)).toBe('symmetric');
});

test('reports an open NAT only after two servers agree on the mapping', () => {
  const result = gather({
    srflx: [mapping(5000, 1000), mapping(5000, 1000)],
    srflxServers: new Set(['stun:a', 'stun:b']),
  });
  expect(classifyNat(result)).toBe('open');
});

test('stays undetermined when only one STUN server replied', () => {
  const result = gather({
    srflx: [mapping(5000, 1000)],
    srflxServers: new Set(['stun:a']),
  });
  expect(classifyNat(result)).toBe('unknown');
});

test('verdict is no-signaling when the broker is unreachable', () => {
  expect(
    decideVerdict(
      signaling(false),
      gather(),
      gather({ hasSrflx: false }),
      'blocked',
    ),
  ).toBe('no-signaling');
});

test('verdict is good with working STUN and an open NAT', () => {
  expect(decideVerdict(signaling(true), gather(), gather(), 'open')).toBe(
    'good',
  );
});

test('verdict falls back to relay when only TURN works', () => {
  expect(
    decideVerdict(
      signaling(true),
      gather({ hasSrflx: false, hasHost: false }),
      gather({ hasRelay: true }),
      'unknown',
    ),
  ).toBe('relay');
});

test('verdict is blocked when neither STUN nor TURN works', () => {
  expect(
    decideVerdict(
      signaling(true),
      gather({ hasSrflx: false }),
      gather(),
      'blocked',
    ),
  ).toBe('blocked');
});

test('an undetermined NAT is limited rather than blocked', () => {
  expect(decideVerdict(signaling(true), gather(), gather(), 'unknown')).toBe(
    'limited',
  );
});

test('a symmetric NAT uses the relay when one is available', () => {
  expect(
    decideVerdict(
      signaling(true),
      gather(),
      gather({ hasRelay: true }),
      'symmetric',
    ),
  ).toBe('relay');
});

test('a symmetric NAT without a relay is blocked', () => {
  expect(decideVerdict(signaling(true), gather(), gather(), 'symmetric')).toBe(
    'blocked',
  );
});

test('maps each NAT type to a row status', () => {
  expect(natStatus('open')).toBe('pass');
  expect(natStatus('blocked')).toBe('fail');
  expect(natStatus('symmetric')).toBe('warn');
  expect(natStatus('unknown')).toBe('warn');
});

test('splits the configured ICE servers into STUN and TURN groups', () => {
  const { stun, turn } = selectIceServers([
    { urls: 'stun:stun.example.org:3478' },
    {
      urls: [
        'turn:relay.example.org:80',
        'turn:relay.example.org:443?transport=tcp',
      ],
      username: 'user',
      credential: 'secret',
    },
  ]);
  expect(stun).toHaveLength(1);
  expect(turn).toHaveLength(1);
  expect(turn[0].urls).toHaveLength(2);
});

test('a server carrying both schemes is usable for both checks', () => {
  const { stun, turn } = selectIceServers([{ urls: ['stun:a', 'turn:b'] }]);
  expect(stun).toHaveLength(1);
  expect(turn).toHaveLength(1);
});

test('an empty ICE server list yields empty groups', () => {
  expect(selectIceServers([])).toEqual({ stun: [], turn: [] });
});

test('the copyable summary includes WebRTC errors', () => {
  const summary = buildSummary(
    signaling(true),
    gather({ error: 'boom' }),
    gather({ hasRelay: true }),
    'open',
    'good',
  );
  expect(summary).toContain('(boom)');
});
