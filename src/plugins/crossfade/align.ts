/**
 * Playback rate that closes a drift over the next `window` seconds, capped at
 * `limit` away from the normal rate.
 *
 * A follower behind its clock (`drift` above zero, in seconds) plays faster to
 * catch up, one ahead of it plays slower to let it pass.
 */
export const nudgeRate = (drift: number, window: number, limit: number) =>
  Math.min(Math.max(1 + drift / window, 1 - limit), 1 + limit);
