import { TabularQAgent } from '../../shared/rl/tabular_q_agent.js';
import { thresholdBand } from '../../shared/rl/discretize.js';
import type { TabularDecision, TabularQSave } from '../../shared/rl/rl_types.js';

export const NETWORK_DEFENSE_RL_ACTIONS = [
  'containServerNeighbor',
  'interceptEnemy',
  'suppressHottest',
  'repairWeakest',
  'deployFirewallGuard',
  'hardenNode',
  'rebootNode',
  'recruitJunior',
  'recruitMid',
  'patrol',
  'idle',
] as const;

export type NetworkDefenseRlAction = typeof NETWORK_DEFENSE_RL_ACTIONS[number];
export const NETWORK_DEFENSE_OBSERVATIONS = ['minimal', 'engineered'] as const;
export type NetworkDefenseObservationVariant = (typeof NETWORK_DEFENSE_OBSERVATIONS)[number];
export const NETWORK_DEFENSE_REWARD_MODES = ['sparse', 'shaped'] as const;
export type NetworkDefenseRewardMode = (typeof NETWORK_DEFENSE_REWARD_MODES)[number];
export type NetworkDefensePolicySpec = {
  observation: NetworkDefenseObservationVariant;
  rewardMode: NetworkDefenseRewardMode;
  random?: () => number;
};
export const DEFAULT_NETWORK_DEFENSE_POLICY_SPEC: NetworkDefensePolicySpec = {
  observation: 'engineered',
  rewardMode: 'shaped',
};
type NetworkDefenseRank = 'senior' | 'mid' | 'junior';
const NETWORK_DEFENSE_RANKS: readonly NetworkDefenseRank[] = ['senior', 'mid', 'junior'];

export type NetworkDefenseRlObservation = {
  rank: NetworkDefenseRank;
  serverHpBand: number;
  serverThreatBand: number;
  infectionBand: number;
  damagedBand: number;
  enemyBand: number;
  firewallBand: number;
  creditBand: number;
  agentBand: number;
  waveBand: number;
};

type RewardSnapshot = {
  elapsed: number;
  kills: number;
  serverHp: number;
  infection: number;
  wave: number;
};

export type NetworkDefenseRlControllerContext = {
  game: any;
  topo: any;
  agents: any[];
  enemyPackets: any[];
  firewalls: Map<unknown, unknown>;
  executeAction: (agent: any, action: NetworkDefenseRlAction, snapshot: any) => boolean;
  buildSnapshot: (now: number) => any;
  now?: () => number;
};

export type NetworkDefenseRlSave = {
  version: 1;
  policies: Record<NetworkDefenseRank, TabularQSave>;
  /** Missing on legacy saves, which used the current engineered/shaped defaults. */
  observation?: NetworkDefenseObservationVariant;
  rewardMode?: NetworkDefenseRewardMode;
};

export class NetworkDefenseRlController {
  readonly spec: NetworkDefensePolicySpec;
  private readonly learners: Record<NetworkDefenseRank, TabularQAgent<NetworkDefenseRlObservation, NetworkDefenseRlAction>>;
  private readonly now: () => number;
  private previousRewards: Record<NetworkDefenseRank, RewardSnapshot>;
  private lastDecision: TabularDecision<NetworkDefenseRlAction> | null = null;
  private lastIntent = { rank: '—', focus: 'SCANNING' };
  private episodeFinished = false;

  constructor(
    private readonly context: NetworkDefenseRlControllerContext,
    spec: Partial<NetworkDefensePolicySpec> = {},
  ) {
    this.spec = { ...DEFAULT_NETWORK_DEFENSE_POLICY_SPEC, ...spec };
    this.learners = createRankLearners(this.spec.observation, this.spec.random);
    this.now = context.now ?? (() => performance.now() / 1000);
    const initial = captureRewardSnapshot(context);
    this.previousRewards = snapshotsForRanks(initial);
  }

  assignAgent(agent: any): void {
    if (this.context.game.gameOver) {
      this.finishEpisode(false);
      return;
    }
    const ruleSnapshot = this.context.buildSnapshot(this.now());
    const observation = observeNetworkDefense(this.context, agent, ruleSnapshot);
    const learner = this.learners[observation.rank];
    learner.observe(observation, this.collectReward(observation.rank));
    const decision = learner.decide(observation);
    this.lastDecision = decision;
    this.lastIntent = { rank: observation.rank.toUpperCase(), focus: `THREAT ${observation.serverThreatBand} · INF ${observation.infectionBand} · ENEMY ${observation.enemyBand}` };
    agent.actionKey = decision.action;
    const executed = this.context.executeAction(agent, decision.action, ruleSnapshot);
    if (!executed) {
      // Invalid spatial targets can still disappear between observation and
      // execution. Penalize the attempted action, then safely idle this agent.
      learner.observe(observation, this.spec.rewardMode === 'shaped' ? -0.8 : 0);
      this.context.executeAction(agent, 'idle', ruleSnapshot);
      agent.actionKey = 'idle';
    }
    this.context.game.rankIntents[agent.rank] = `${agent.actionKey}${decision.exploratory ? ' [explore]' : ''}`;
    this.context.game.waveActions[agent.rank] = (this.context.game.waveActions[agent.rank] || 0) + 1;
  }

  finishEpisode(victory: boolean): void {
    if (this.episodeFinished) return;
    for (const rank of NETWORK_DEFENSE_RANKS) {
      const terminal = this.collectReward(rank) + (victory ? 40 : -40);
      this.learners[rank].finishEpisode(terminal);
    }
    this.episodeFinished = true;
  }

  serialize(): NetworkDefenseRlSave {
    return {
      version: 1,
      observation: this.spec.observation,
      rewardMode: this.spec.rewardMode,
      policies: Object.fromEntries(
        NETWORK_DEFENSE_RANKS.map((rank) => [rank, this.learners[rank].serialize()]),
      ) as NetworkDefenseRlSave['policies'],
    };
  }

  restore(save: NetworkDefenseRlSave | TabularQSave): void {
    if ('policies' in save) {
      const savedObservation = save.observation ?? DEFAULT_NETWORK_DEFENSE_POLICY_SPEC.observation;
      const savedRewardMode = save.rewardMode ?? DEFAULT_NETWORK_DEFENSE_POLICY_SPEC.rewardMode;
      if (savedObservation !== this.spec.observation || savedRewardMode !== this.spec.rewardMode) return;
      for (const rank of NETWORK_DEFENSE_RANKS) {
        this.learners[rank].restore(save.policies[rank]);
      }
    } else {
      // Migrate the first shared-policy prototype without discarding learning.
      for (const rank of NETWORK_DEFENSE_RANKS) this.learners[rank].restore(save);
    }
    const current = captureRewardSnapshot(this.context);
    this.previousRewards = snapshotsForRanks(current);
    this.episodeFinished = false;
  }

  get epsilon(): number {
    return average(Object.values(this.learners).map((learner) => learner.epsilon));
  }

  get knownStates(): number {
    return Object.values(this.learners).reduce((sum, learner) => sum + learner.knownStates, 0);
  }

  get trainingSteps(): number {
    return Object.values(this.learners).reduce((sum, learner) => sum + learner.trainingSteps, 0);
  }

  get decision(): TabularDecision<NetworkDefenseRlAction> | null {
    return this.lastDecision;
  }

  get intent(): Readonly<{ rank: string; focus: string }> { return this.lastIntent; }

  setEvaluationMode(enabled: boolean): void {
    for (const learner of Object.values(this.learners)) learner.setEvaluationMode(enabled);
  }

  get finished(): boolean {
    return this.episodeFinished;
  }

  private collectReward(rank: NetworkDefenseRank): number {
    const current = captureRewardSnapshot(this.context);
    const previous = this.previousRewards[rank];
    const reward = this.spec.rewardMode === 'sparse' ? 0 : (current.elapsed - previous.elapsed) * 0.02
      + (current.kills - previous.kills) * 0.4
      + (current.serverHp - previous.serverHp) * 0.8
      - (current.infection - previous.infection) * 8
      + (current.wave - previous.wave) * 6;
    this.previousRewards[rank] = current;
    return clamp(reward, -20, 20);
  }
}

function createRankLearners(
  observation: NetworkDefenseObservationVariant,
  random?: () => number,
): Record<NetworkDefenseRank, TabularQAgent<NetworkDefenseRlObservation, NetworkDefenseRlAction>> {
  return Object.fromEntries(
    NETWORK_DEFENSE_RANKS.map((rank) => [rank, createNetworkDefenseLearner(observation, random)]),
  ) as Record<NetworkDefenseRank, TabularQAgent<NetworkDefenseRlObservation, NetworkDefenseRlAction>>;
}

function snapshotsForRanks(snapshot: RewardSnapshot): Record<NetworkDefenseRank, RewardSnapshot> {
  return Object.fromEntries(
    NETWORK_DEFENSE_RANKS.map((rank) => [rank, { ...snapshot }]),
  ) as Record<NetworkDefenseRank, RewardSnapshot>;
}

function createNetworkDefenseLearner(
  observation: NetworkDefenseObservationVariant,
  random?: () => number,
): TabularQAgent<NetworkDefenseRlObservation, NetworkDefenseRlAction> {
  return new TabularQAgent({
    actions: NETWORK_DEFENSE_RL_ACTIONS,
    encodeState: (value) => encodeNetworkDefenseObservation(value, observation),
    allowedActionIndices: allowedNetworkDefenseActions,
    learningRate: 0.14,
    discount: 0.94,
    initialEpsilon: 0.24,
    minimumEpsilon: 0.04,
    maximumEpsilon: 0.5,
    epsilonDecay: 0.9995,
    episodeEpsilonBoost: 0.03,
    episodeMaximumEpsilon: 0.28,
    random,
  });
}

export function observeNetworkDefense(
  context: Pick<NetworkDefenseRlControllerContext, 'game' | 'topo' | 'agents' | 'enemyPackets' | 'firewalls'>,
  agent: any,
  snapshot?: any,
): NetworkDefenseRlObservation {
  const nodes = context.topo.nodes as any[];
  const server = context.topo.server;
  const serverNeighbors = snapshot?.serverNeighbors ?? [];
  const averageInfection = nodes.reduce((sum, node) => sum + (node.infection ?? 0), 0)
    / Math.max(1, nodes.length);
  const damaged = nodes.filter((node) => !node.isServer && node.hp < node.maxHp * 0.86).length;
  const serverThreat = serverNeighbors.length
    ? Math.max(...serverNeighbors.map((node: any) => node.infection ?? 0))
    : 0;
  return {
    rank: agent.rank,
    serverHpBand: thresholdBand(server.hp / server.maxHp, [0.25, 0.5, 0.75]),
    serverThreatBand: thresholdBand(serverThreat, [0.15, 0.35, 0.6]),
    infectionBand: thresholdBand(averageInfection, [0.08, 0.22, 0.45]),
    damagedBand: countBand(damaged),
    enemyBand: countBand(context.enemyPackets.length),
    firewallBand: countBand(context.firewalls.size),
    creditBand: thresholdBand(context.game.credits, [80, 160, 300]),
    agentBand: countBand(context.agents.length),
    waveBand: Math.min(4, Math.floor((context.game.wave - 1) / 2)),
  };
}

export function encodeNetworkDefenseObservation(
  observation: NetworkDefenseRlObservation,
  variant: NetworkDefenseObservationVariant = 'engineered',
): string {
  if (variant === 'minimal') {
    return [
      observation.rank,
      observation.serverHpBand,
      observation.serverThreatBand,
      observation.infectionBand,
      observation.enemyBand,
      observation.waveBand,
    ].join(':');
  }
  return [
    observation.rank,
    observation.serverHpBand,
    observation.serverThreatBand,
    observation.infectionBand,
    observation.damagedBand,
    observation.enemyBand,
    observation.firewallBand,
    observation.creditBand,
    observation.agentBand,
    observation.waveBand,
  ].join(':');
}

function allowedNetworkDefenseActions(observation: NetworkDefenseRlObservation): readonly number[] {
  return NETWORK_DEFENSE_RL_ACTIONS
    .map((action, index) => {
      if (action === 'containServerNeighbor' && observation.serverThreatBand === 0) return -1;
      if (action === 'interceptEnemy' && observation.enemyBand === 0) return -1;
      if (action === 'suppressHottest' && observation.infectionBand === 0) return -1;
      if (action === 'repairWeakest' && observation.damagedBand === 0) return -1;
      if (action === 'deployFirewallGuard' && observation.enemyBand === 0) return -1;
      if (action === 'hardenNode' && observation.damagedBand === 0 && observation.infectionBand === 0) return -1;
      if (action === 'rebootNode' && observation.infectionBand === 0) return -1;
      if (action === 'recruitJunior'
        && (observation.rank !== 'senior' || observation.creditBand === 0 || observation.agentBand >= 3)) return -1;
      if (action === 'recruitMid'
        && (observation.rank !== 'senior' || observation.creditBand < 2 || observation.agentBand >= 3)) return -1;
      return index;
    })
    .filter((index) => index >= 0);
}


function captureRewardSnapshot(
  context: Pick<NetworkDefenseRlControllerContext, 'game' | 'topo'>,
): RewardSnapshot {
  const nodes = context.topo.nodes as any[];
  return {
    elapsed: context.game.elapsed,
    kills: context.game.kills,
    serverHp: context.topo.server.hp,
    infection: nodes.reduce((sum, node) => sum + (node.infection ?? 0), 0) / Math.max(1, nodes.length),
    wave: context.game.wave,
  };
}

function countBand(value: number): number {
  if (value <= 0) return 0;
  if (value === 1) return 1;
  if (value <= 3) return 2;
  return 3;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}
