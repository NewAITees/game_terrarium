import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DroneBastionAgent } from '../apps/drone-bastion/drone_bastion_agent.js';
import { DroneBastionDqnAgent } from '../apps/drone-bastion/drone_bastion_dqn_agent.js';
import { runDroneBastionEpisode } from '../apps/drone-bastion/drone_bastion_episode.js';
import { mulberry32 } from '../shared/rl/random.js';
import { createSeedPlan } from '../shared/rl/seed_plan.js';
import { describe, type Distribution } from './rl/research_stats.js';

type ComparableAgent = Parameters<typeof runDroneBastionEpisode>[0] & {
  setEvaluationMode(enabled: boolean): void;
  readonly trainingSteps: number;
  readonly knownStates: number;
};

export type DroneDqnComparisonCondition = 'tabular-minimal' | 'dqn-engineered' | 'dqn-minimal';
export type DroneDqnComparisonRow = {
  condition: DroneDqnComparisonCondition;
  trainSeeds: number[];
  holdoutSeeds: number[];
  trainingSteps: number;
  knownStates: number;
  taskReturns: number[];
  medianTaskReturn: number;
  meanTaskReturn: number;
  distribution: Distribution;
  repeats: number;
};

export function runDroneDqnComparison(
  trainingEpisodes: number,
  evaluationEpisodes: number,
  capSeconds: number,
  seed = 1,
  repeats = 3,
): DroneDqnComparisonRow[] {
  const plan = createSeedPlan(trainingEpisodes, evaluationEpisodes);
  const trainSeeds = [...plan.train];
  const holdoutSeeds = [...plan.holdout];
  return (['tabular-minimal', 'dqn-engineered', 'dqn-minimal'] as const).map((condition) => {
    const taskReturns: number[] = [];
    let trainingSteps = 0;
    let knownStates = 0;
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      // Every condition receives the same repeat stream. Different algorithms consume it at
      // different rates, but no condition is assigned a deliberately luckier seed.
      const agent = createAgent(condition, mulberry32(seed + repeat * 100_003));
      for (const episodeSeed of trainSeeds) runDroneBastionEpisode(agent, episodeSeed, capSeconds);
      agent.setEvaluationMode(true);
      for (const episodeSeed of holdoutSeeds) {
        taskReturns.push(runDroneBastionEpisode(agent, episodeSeed, capSeconds).taskReturn);
      }
      trainingSteps += agent.trainingSteps;
      knownStates += agent.knownStates;
    }
    const distribution = describe(taskReturns);
    return {
      condition,
      trainSeeds,
      holdoutSeeds,
      trainingSteps,
      knownStates: Math.round(knownStates / repeats),
      taskReturns,
      medianTaskReturn: distribution.median,
      meanTaskReturn: distribution.mean,
      distribution,
      repeats,
    };
  });
}

function createAgent(condition: DroneDqnComparisonCondition, random: () => number): ComparableAgent {
  if (condition === 'tabular-minimal') return new DroneBastionAgent({ observation: 'minimal', actions: 'full', random });
  return new DroneBastionDqnAgent(condition === 'dqn-engineered' ? 'engineered' : 'minimal', random);
}

async function main(): Promise<void> {
  const args = new Map(process.argv.slice(2).map((token) => {
    const [key, value = ''] = token.replace(/^--/, '').split('=');
    return [key, value];
  }));
  const trainingEpisodes = Math.max(1, Number(args.get('train') ?? 400));
  const evaluationEpisodes = Math.max(1, Number(args.get('evaluate') ?? 32));
  const capSeconds = Math.max(1, Number(args.get('cap') ?? 120));
  const seed = Number(args.get('seed') ?? 1);
  const repeats = Math.max(1, Number(args.get('repeats') ?? 3));
  const output = resolve(args.get('output') ?? 'logs/rl-research/drone-bastion-dqn-comparison.json');
  const rows = runDroneDqnComparison(trainingEpisodes, evaluationEpisodes, capSeconds, seed, repeats);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify({ trainingEpisodes, evaluationEpisodes, capSeconds, seed, repeats, rows }, null, 2)}\n`);
  for (const row of rows) {
    console.log(`${row.condition.padEnd(16)} median=${row.medianTaskReturn.toFixed(3)} 95%=${row.distribution.lower95.toFixed(3)}–${row.distribution.upper95.toFixed(3)} mean=${row.meanTaskReturn.toFixed(3)} steps=${row.trainingSteps}`);
  }
  console.log(`saved ${output}`);
}

if (require.main === module) void main();
