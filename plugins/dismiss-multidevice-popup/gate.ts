// pear-desktop handled the "are you there?" prompt from its core page script,
// but only when playback had been active recently and never more than once per
// cooldown, so it never fought a user who had deliberately paused.

/** Only handle the prompt while playback was active this recently. */
export const RESUME_WINDOW_MS = 60_000;
/** At most one handled prompt per this interval: the prompt can be re-shown. */
export const HANDLE_COOLDOWN_MS = 10_000;

/** Whether a prompt seen at `now` may be handled. */
export function canHandle(now: number, lastActivityAt: number, lastHandledAt: number) {
  return now - lastActivityAt < RESUME_WINDOW_MS && now - lastHandledAt >= HANDLE_COOLDOWN_MS;
}
