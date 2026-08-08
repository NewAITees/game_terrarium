import { mulberry32 } from '../../shared/rl/random.js';

/**
 * The uncertainty layer. A search that ranks configurations by a point estimate ranks them by
 * whichever one drew the luckiest agents, and the more configurations it tries the more certain
 * that is to happen. Everything here exists so a comparison can say "better" and mean it.
 */

export type Distribution = {
  count: number;
  mean: number;
  median: number;
  /** Lower bound of the 95% bootstrap interval on the median. This is what promotion compares. */
  lower95: number;
  upper95: number;
  min: number;
  max: number;
};

export function mean(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function quantile(sorted: readonly number[], fraction: number): number {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/**
 * Bootstrap interval on the median, with a fixed RNG seed so the same sample always yields the same
 * interval — a ledger whose confidence bounds drift on re-read cannot be audited.
 */
export function describe(values: readonly number[], resamples = 2000, seed = 0x5eed): Distribution {
  if (!values.length) return { count: 0, mean: 0, median: 0, lower95: 0, upper95: 0, min: 0, max: 0 };
  const random = mulberry32(seed);
  const medians: number[] = [];
  const sample = new Array<number>(values.length);
  for (let round = 0; round < resamples; round += 1) {
    for (let index = 0; index < values.length; index += 1) sample[index] = values[Math.floor(random() * values.length)];
    medians.push(median(sample));
  }
  medians.sort((left, right) => left - right);
  return {
    count: values.length,
    mean: mean(values),
    median: median(values),
    lower95: quantile(medians, .025),
    upper95: quantile(medians, .975),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

/**
 * Whether `candidate` beats `champion` by more than either sample can explain. Deliberately
 * conservative: the challenger's lower bound must clear the champion's median, so a tie goes to the
 * incumbent and a search cannot ratchet its way up on noise alone.
 */
export function beats(candidate: Distribution, champion: Distribution): boolean {
  return candidate.lower95 > champion.median;
}
