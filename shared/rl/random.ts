/**
 * Seeded RNG for reinforcement-learning runs.
 *
 * Exploration is the largest single source of variance between two runs of the same configuration,
 * so an automated search that cannot replay a result cannot tell a real effect from a lucky agent.
 * Deriving the stream from (spec, repeat) makes every row in the research ledger reproducible.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** A distinct, stable stream per (run, repeat) pair. */
export function repeatRandom(key: string, repeat: number): () => number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return mulberry32((hash ^ Math.imul(repeat + 1, 0x9e3779b1)) >>> 0);
}
