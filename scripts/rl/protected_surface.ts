import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Content hashes for the files a hypothesis may never touch.
 *
 * Listing the protected files was not protection: an automated loop that runs for days will happily
 * keep going after something quietly weakened the seed split or the promotion test, and every row
 * written afterwards would be incomparable with every row written before — undetectably, because
 * nothing about the output changes.
 *
 * So the contract hashes them and refuses to run on a mismatch. The seal is not a lock: these files
 * are meant to be improved. It only requires that changing them is a deliberate, visible act
 * (`npm run research:seal`) rather than something that happens on the way to somewhere else, and
 * that the ledger has a marker for where the rules changed.
 */

export const SEALED_FILES = [
  'shared/rl/seed_plan.ts',
  'shared/rl/experiment_spec.ts',
  'scripts/rl/research_stats.ts',
  'scripts/rl/research_ledger.ts',
  'scripts/rl/research_runner.ts',
  'scripts/rl/research_contract.ts',
] as const;

export type SealedDigest = Record<string, string>;

export function repositoryRoot(): string {
  let directory = __dirname;
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      readFileSync(join(directory, 'package.json'), 'utf8');
      return directory;
    } catch {
      directory = dirname(directory);
    }
  }
  throw new Error('could not locate the repository root from the research contract');
}

export function digestSealedFiles(root = repositoryRoot()): SealedDigest {
  const digest: SealedDigest = {};
  for (const file of SEALED_FILES) {
    const contents = readFileSync(resolve(root, file), 'utf8');
    // Line endings differ between checkouts; the rules the file expresses do not.
    digest[file] = createHash('sha256').update(contents.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
  }
  return digest;
}

export function readSeal(root = repositoryRoot()): SealedDigest | null {
  try {
    return JSON.parse(readFileSync(sealPath(root), 'utf8')) as SealedDigest;
  } catch {
    return null;
  }
}

export function sealPath(root = repositoryRoot()): string {
  return resolve(root, 'scripts/rl/protected_surface.seal.json');
}

export type SealDrift = { file: string; expected: string; actual: string };

export function compareSeal(root = repositoryRoot()): { sealed: boolean; drift: SealDrift[] } {
  const seal = readSeal(root);
  if (!seal) return { sealed: false, drift: [] };
  const current = digestSealedFiles(root);
  const drift: SealDrift[] = [];
  for (const file of SEALED_FILES) {
    if (seal[file] !== current[file]) drift.push({ file, expected: seal[file] ?? '(absent)', actual: current[file] });
  }
  return { sealed: true, drift };
}
