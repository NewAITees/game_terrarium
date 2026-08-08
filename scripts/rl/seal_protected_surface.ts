import { writeFileSync } from 'node:fs';
import { compareSeal, digestSealedFiles, repositoryRoot, sealPath } from './protected_surface.js';

/**
 * Re-seals the protected surface after a deliberate change to it.
 *
 * Running this is the act that says "I changed a rule the comparison depends on, and I know the
 * ledger's older rows were measured under the previous one". It prints what moved before writing,
 * so the acknowledgement is informed rather than reflexive.
 */
const root = repositoryRoot();
const { sealed, drift } = compareSeal(root);

if (sealed && !drift.length) {
  console.log('protected surface unchanged; seal already current');
} else {
  if (!sealed) console.log('no seal on record — writing the first one');
  for (const entry of drift) console.log(`  changed: ${entry.file} (${entry.expected} -> ${entry.actual})`);
  writeFileSync(sealPath(root), `${JSON.stringify(digestSealedFiles(root), null, 2)}\n`, 'utf8');
  console.log(`sealed ${sealPath(root)}`);
  if (drift.length) {
    console.log('ledger rows written before this point were measured under the previous rules;'
      + ' treat comparisons across the boundary with care');
  }
}
