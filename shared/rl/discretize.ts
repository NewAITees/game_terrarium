/** Returns the zero-based bucket below the first threshold, or the final bucket. */
export function thresholdBand(value: number, thresholds: readonly number[]): number {
  const index = thresholds.findIndex((threshold) => value < threshold);
  return index < 0 ? thresholds.length : index;
}

/** Returns a non-negative fixed-width bucket, capped at the supplied maximum. */
export function fixedWidthBand(value: number, width: number, maximumBand: number): number {
  if (!(width > 0) || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maximumBand, Math.floor(value / width)));
}
