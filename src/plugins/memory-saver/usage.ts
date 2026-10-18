/** Blink reports one `MemoryUsageDetails` bucket per cache kind. */
type BlinkUsage = Record<string, { liveSize?: number } | undefined>;

export const DEFAULT_THRESHOLD_MB = 64;
const MB = 1024 * 1024;

/** Sum of the live bytes in Blink's caches; `0` when the renderer returned nothing usable. */
export const liveBytes = (usage: unknown) => {
  if (!usage || typeof usage !== 'object') return 0;

  let total = 0;
  for (const details of Object.values(usage as BlinkUsage)) {
    if (typeof details?.liveSize === 'number') total += details.liveSize;
  }
  return total;
};

/** A stored value that is not a positive number falls back to the default. */
export const thresholdBytesFor = (thresholdMB: unknown) => {
  const value = Number(thresholdMB);
  return (
    (Number.isFinite(value) && value > 0 ? value : DEFAULT_THRESHOLD_MB) * MB
  );
};
