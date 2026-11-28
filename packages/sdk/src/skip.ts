// One skip per track across plugins: sfw-music and skip-ai-slop both listen for
// tracks they dislike, and without a shared latch an explicit, AI-flagged track
// advances two songs. Page parts share this module instance.
//
// A claim only blocks *another* plugin: a plugin that skips the same track again
// later (a repeated queue entry, repeat-all) still may, relying on its own loop
// guard. Claims expire so a skip that never arrives can be retried.

interface Claim {
  at: number;
  owner: string;
}

const claims = new Map<string, Claim>();
const CLAIM_WINDOW_MS = 10_000;

/**
 * Whether `owner` should perform the skip for `videoId`. The first plugin wins;
 * a different plugin reacting to the same track leaves it to the first.
 */
export function claimSkip(videoId: string, owner: string, windowMs = CLAIM_WINDOW_MS): boolean {
  const now = Date.now();
  for (const [id, claim] of claims) if (now - claim.at > windowMs) claims.delete(id);
  const claim = claims.get(videoId);
  if (claim && claim.owner !== owner && now - claim.at <= windowMs) return false;
  claims.set(videoId, { at: now, owner });
  return true;
}

/** Gives the claim back (e.g. the skip was rate-limited). */
export function releaseSkip(videoId: string, owner?: string) {
  const claim = claims.get(videoId);
  if (!owner || claim?.owner === owner) claims.delete(videoId);
}

/** Clears every claim; tests use this between fixtures. */
export function resetSkipClaims() {
  claims.clear();
}
