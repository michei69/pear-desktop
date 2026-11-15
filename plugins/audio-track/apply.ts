import type { YTPlayerApi } from "@pear/sdk";
import { desiredTrack, readCurrentTrackId, readTracks, trackId } from "./tracks.ts";

/** The player accepts `setAudioTrack` yet can keep the old track and re-emit; cap the retries. */
export const MAX_REAPPLY_ATTEMPTS = 3;
const REAPPLY_MS = 200;

/** What the retry loop needs from the plugin's page context. */
export interface TrackReapplyContext {
  config(): { readonly audioTrack: string; readonly preferOriginal: boolean };
  /** YTM's player API, or null while it is not ready. */
  api(): YTPlayerApi | null;
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout> | undefined): void;
}

/**
 * Re-applies the preferred audio track to the current video. Split from the
 * picker so the retry budget can be tested without a DOM.
 */
export function createTrackReapply(ctx: TrackReapplyContext) {
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const apply = () => {
    const api = ctx.api();
    if (!api) return;
    const tracks = readTracks(api);
    // One track is no choice at all.
    if (tracks.length < 2) return;

    const { audioTrack, preferOriginal } = ctx.config();
    const desired = desiredTrack(tracks, audioTrack, preferOriginal);
    if (!desired) return;

    const id = trackId(desired);
    if (!id || id === readCurrentTrackId(api)) {
      attempts = 0;
      return;
    }
    if (attempts >= MAX_REAPPLY_ATTEMPTS) return;
    attempts += 1;
    try {
      api.setAudioTrack?.(desired);
    } catch {
      // YTM throws when a track cannot be served for the current player type.
    }
  };

  const schedule = (delay = REAPPLY_MS) => {
    ctx.clearTimeout(timer);
    timer = ctx.setTimeout(apply, delay);
  };

  return {
    apply,
    schedule,
    /** A new track starts with a fresh retry budget; apply shortly, like pear-desktop. */
    reset() {
      attempts = 0;
      schedule();
    },
    /** A pick or a settings change applies at once, with a fresh budget. */
    resetNow() {
      attempts = 0;
      apply();
    },
    stop() {
      ctx.clearTimeout(timer);
    },
  };
}
