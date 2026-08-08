import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { sameEnvironment, specHash, type ExperimentSpec } from '../../shared/rl/experiment_spec.js';
import type { Distribution } from './research_stats.js';
import { beats } from './research_stats.js';

/**
 * The append-only record of every experiment ever run.
 *
 * It is the searcher's whole memory: what has been tried (so a restart does not re-run it), what
 * each configuration scored, and which change descends from which. Nothing is ever rewritten, so a
 * champion can always be recomputed from the raw rows rather than trusted from a cached summary.
 */

export type ResearchRow = {
  schemaVersion: 1;
  /** `specHash` — identical specs share a hash whatever their budget. */
  id: string;
  /** The row this spec was derived from, so a chain of changes stays readable. */
  parent: string | null;
  createdAt: string;
  spec: ExperimentSpec;
  /** Hold-out task return. The only field a promotion decision may read. */
  holdout: Distribution;
  /** Training-seed task return. Diagnostic: the gap to `holdout` is the overfitting measure. */
  training: Distribution;
  /** Shaped return by channel, averaged per episode. Diagnostic only. */
  channels: { task: number; progress: number; safety: number; behavior: number };
  /** Fraction of the learner's pay that was not the task itself. */
  shapingShare: number;
  trainingSteps: number;
  knownStates: number;
  wallSeconds: number;
  /**
   * Path, relative to the ledger, of the trained model this row scored. Absent on failed rows and on
   * rows written before models were kept.
   */
  modelFile?: string;
  /** Set when the run failed; `holdout` is meaningless in that case. */
  error?: string;
};

export class ResearchLedger {
  private readonly rows: ResearchRow[] = [];
  private appendQueue: Promise<void> = Promise.resolve();

  private constructor(readonly path: string) {}

  static async open(path: string): Promise<ResearchLedger> {
    const ledger = new ResearchLedger(path);
    let text = '';
    try {
      text = await readFile(path, 'utf8');
    } catch {
      return ledger;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        ledger.rows.push(JSON.parse(line) as ResearchRow);
      } catch {
        // A half-written final line is what a killed worker leaves behind. Everything before it is
        // still valid, so the run resumes rather than starting the whole search over.
      }
    }
    return ledger;
  }

  get all(): readonly ResearchRow[] {
    return this.rows;
  }

  /** Rows that ran without error, for the game the search is currently working on. */
  completed(gameId: string): ResearchRow[] {
    return this.rows.filter((row) => !row.error && row.spec.gameId === gameId);
  }

  /**
   * Whether this spec has already been measured at at least this budget. A spec seen only at a
   * smaller budget is deliberately *not* considered done — running it longer is how a late bloomer
   * gets its second chance.
   */
  has(spec: ExperimentSpec): boolean {
    const id = specHash(spec);
    return this.rows.some((row) => (
      row.id === id && !row.error
      && row.spec.budget.episodes >= spec.budget.episodes
      && row.spec.budget.repeats >= spec.budget.repeats
    ));
  }

  best(spec: ExperimentSpec): ResearchRow | undefined {
    const id = specHash(spec);
    return this.completed(spec.gameId)
      .filter((row) => row.id === id)
      .sort((left, right) => right.spec.budget.episodes - left.spec.budget.episodes)[0];
  }

  /**
   * The current champion: the highest-evidence row that no other row beats outright.
   *
   * Diagnostic rows are excluded by construction, not by convention — they are allowed to use
   * demonstrations, privileged state or any other crutch that answers "why is this failing", and
   * none of that may ever become the shipped agent. See CLAUDE.md's no-hand-authored-policy rule.
   */
  champion(gameId: string, reference?: ExperimentSpec): ResearchRow | undefined {
    const eligible = this.completed(gameId)
      .filter((row) => !row.spec.diagnostic && row.holdout.count > 0)
      .filter((row) => !reference || sameEnvironment(row.spec, reference))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    if (!eligible.length) return undefined;
    return eligible.reduce((best, row) => (beats(row.holdout, best.holdout) ? row : best));
  }

  async append(row: ResearchRow): Promise<void> {
    this.rows.push(row);
    // appendFile calls issued concurrently are not guaranteed to remain whole-line writes. Chain
    // them in completion order so a killed search can lose at most its final line, never splice two
    // valid rows into one invalid JSON record.
    this.appendQueue = this.appendQueue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, `${JSON.stringify(row)}\n`, 'utf8');
    });
    await this.appendQueue;
  }
}
