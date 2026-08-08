import type { ExperimentSpec } from '../../shared/rl/experiment_spec.js';
import { resolveAdapter } from './research_adapters.js';
import { runSpec } from './research_runner.js';

/**
 * Runs exactly one spec in its own process.
 *
 * One process per spec is not only for parallelism: a spec owns module-level state through the
 * game's own code paths, and the isolation is what guarantees one experiment's difficulty or reward
 * weights cannot leak into the next one's result.
 */

type WorkerRequest = { spec: ExperimentSpec; parent: string | null; evaluationEpisodes?: number };

process.on('message', (message: WorkerRequest) => {
  try {
    const adapter = resolveAdapter(message.spec.gameId);
    const result = runSpec(adapter, message.spec, message.parent, { evaluationEpisodes: message.evaluationEpisodes });
    process.send?.({ ok: true, row: result.row, model: result.model });
  } catch (error) {
    process.send?.({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
