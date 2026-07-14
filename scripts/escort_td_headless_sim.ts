import { EscortTdRuntime } from '../game/escort_td_runtime';
import type { EscortTdMetaProgress, EscortTdRunResult } from '../shared/types/escort_td';

type RunSummary = {
  seed: number;
  outcome: 'failed' | 'cleared' | 'timeout';
  wave: number;
  progressPercent: number;
  score: number;
  chips: number;
  simSeconds: number;
};

function parseArgs(argv: string[]): { runs: number; maxSeconds: number; seedStart: number; meta: Partial<EscortTdMetaProgress> } {
  const args = Object.fromEntries(argv.map((entry) => {
    const [key, value] = entry.replace(/^--/, '').split('=');
    return [key, value];
  }));
  return {
    runs: Number(args.runs ?? 20),
    maxSeconds: Number(args.maxSeconds ?? 600),
    seedStart: Number(args.seed ?? 1),
    meta: args.meta ? JSON.parse(args.meta) : {},
  };
}

function runOne(seed: number, maxSeconds: number, meta: Partial<EscortTdMetaProgress>): RunSummary {
  const runtime = new EscortTdRuntime(seed, meta);
  const step = 0.05;
  let elapsed = 0;
  let snapshot = runtime.getSnapshot();
  while (elapsed < maxSeconds && !snapshot.over && !snapshot.won) {
    runtime.advance(1, step);
    elapsed += 1;
    snapshot = runtime.getSnapshot();
  }
  const result: EscortTdRunResult | null = snapshot.result;
  return {
    seed,
    outcome: result?.outcome ?? 'timeout',
    wave: snapshot.wave,
    progressPercent: result?.progressPercent ?? snapshot.progressPercent,
    score: result?.score ?? 0,
    chips: result?.chips ?? 0,
    simSeconds: elapsed,
  };
}

function fmtPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function main(): void {
  const { runs, maxSeconds, seedStart, meta } = parseArgs(process.argv.slice(2));
  const summaries: RunSummary[] = [];
  for (let i = 0; i < runs; i++) {
    const seed = seedStart + i;
    const startedAt = Date.now();
    const summary = runOne(seed, maxSeconds, meta);
    const wallMs = Date.now() - startedAt;
    summaries.push(summary);
    console.log(
      `run ${String(i + 1).padStart(3)} seed=${seed} outcome=${summary.outcome.padEnd(7)} wave=${String(summary.wave).padStart(2)} ` +
      `progress=${fmtPercent(summary.progressPercent).padStart(6)} score=${String(summary.score).padStart(6)} chips=${String(summary.chips).padStart(4)} ` +
      `simSec=${String(summary.simSeconds).padStart(3)} wallMs=${wallMs}`,
    );
  }

  const clears = summaries.filter((s) => s.outcome === 'cleared').length;
  const fails = summaries.filter((s) => s.outcome === 'failed').length;
  const timeouts = summaries.filter((s) => s.outcome === 'timeout').length;
  const avg = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / (values.length || 1);

  console.log('---');
  console.log(`runs=${runs} cleared=${clears} (${fmtPercent((clears / runs) * 100)}) failed=${fails} timeout=${timeouts}`);
  console.log(`avg wave=${avg(summaries.map((s) => s.wave)).toFixed(2)}`);
  console.log(`avg progress=${fmtPercent(avg(summaries.map((s) => s.progressPercent)))}`);
  console.log(`avg score=${avg(summaries.map((s) => s.score)).toFixed(1)}`);
  console.log(`avg chips=${avg(summaries.map((s) => s.chips)).toFixed(2)}`);
  console.log(`avg sim seconds to finish=${avg(summaries.map((s) => s.simSeconds)).toFixed(1)}`);

  if (clears === 0 && fails === 0) {
    console.error('all runs timed out without a result — check maxSeconds or advance-coverage gating');
    process.exit(1);
  }
}

main();
