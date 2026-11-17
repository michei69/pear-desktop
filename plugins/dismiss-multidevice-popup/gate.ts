// Handle the "are you there?" prompt only when playback was active recently and
// never more than once per cooldown, so a user who deliberately paused is left alone.

/** Only handle the prompt while playback was active this recently. */
export const RESUME_WINDOW_MS = 60_000;
/** At most one handled prompt per this interval: the prompt can be re-shown. */
export const HANDLE_COOLDOWN_MS = 10_000;
/** How recently the prompt must have paused playback for the dismissal to resume it. */
export const RESUME_PAUSE_MS = 5_000;

/** Whether a prompt seen at `now` may be handled. */
export function canHandle(now: number, lastActivityAt: number, lastHandledAt: number) {
  return now - lastActivityAt < RESUME_WINDOW_MS && now - lastHandledAt >= HANDLE_COOLDOWN_MS;
}

/**
 * Whether the dismissal may undo the pause it found. The prompt pauses playback
 * when it appears, so a pause from just now is the prompt's own; an older one is
 * the user's and must be left alone.
 */
export function shouldResume(now: number, pausedAt: number) {
  return pausedAt > 0 && now - pausedAt < RESUME_PAUSE_MS;
}
