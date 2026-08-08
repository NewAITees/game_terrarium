import type { ResearchRow } from './research_ledger.js';

/** One immutable artifact per ledger row, even when the spec hash is reused at a larger budget. */
export function modelArtifactName(row: ResearchRow): string {
  const timestamp = row.createdAt.replace(/[^0-9]/g, '');
  return `${row.id}-${row.spec.budget.episodes}e-${row.spec.budget.repeats}r-${timestamp}.json`;
}
