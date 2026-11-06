/**
 * Coalesces the window in which a remote edit is applied. Outgoing player
 * state must stay quiet until the frame in which the edit landed has passed,
 * otherwise a local echo is reported back to the peer as a local change.
 */
export const createIgnoreGate = (releaseAfterMs = 16) => {
  let active = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  return {
    get active() {
      return active;
    },
    /** Starts holding; a pending release is cancelled. */
    hold() {
      cancel();
      active = true;
    },
    /** Allows outgoing state again after one frame. */
    release() {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        active = false;
      }, releaseAfterMs);
    },
    /** Drops the hold immediately (plugin stop). */
    reset() {
      cancel();
      active = false;
    },
  };
};

export type IgnoreGate = ReturnType<typeof createIgnoreGate>;
