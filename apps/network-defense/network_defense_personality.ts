import type {
  NetworkDefenseAgent,
  NetworkDefenseObserverSnapshot,
  NetworkDefensePersonality,
  NetworkDefenseRank,
  NetworkDefenseRule,
} from '../../shared/types/network_defense.js';

const PERSONALITY_LIBRARY: Record<NetworkDefenseRank, NetworkDefensePersonality[]> = {
  senior: [
    {
      key: 'sentinel',
      label: 'Sentinel',
      summary: 'server-first containment',
      priorities: ['containServerNeighbor', 'hardenNode', 'rebootNode', 'recruitMid', 'patrol'],
    },
    {
      key: 'hunter',
      label: 'Hunter',
      summary: 'frontier interception',
      priorities: ['interceptEnemy', 'suppressHottest', 'deployFirewallGuard', 'patrol', 'containServerNeighbor'],
    },
  ],
  mid: [
    {
      key: 'architect',
      label: 'Architect',
      summary: 'firewalls and stabilization',
      priorities: ['deployFirewallGuard', 'hardenNode', 'suppressHottest', 'patrol', 'interceptEnemy'],
    },
    {
      key: 'skirmisher',
      label: 'Skirmisher',
      summary: 'rapid reaction pressure',
      priorities: ['interceptEnemy', 'suppressHottest', 'patrol', 'deployFirewallGuard', 'hardenNode'],
    },
  ],
  junior: [
    {
      key: 'medic',
      label: 'Medic',
      summary: 'repair and recovery',
      priorities: ['repairWeakest', 'hardenNode', 'patrol', 'clearPathTo'],
    },
    {
      key: 'sweeper',
      label: 'Sweeper',
      summary: 'clear paths and keep flow moving',
      priorities: ['clearPathTo', 'repairWeakest', 'patrol', 'hardenNode'],
    },
  ],
};

const ACTION_LABELS = {
  containServerNeighbor: 'seal the server ring',
  interceptEnemy: 'intercept deep packets',
  suppressHottest: 'cool the hottest cluster',
  repairWeakest: 'patch the weakest node',
  deployFirewallGuard: 'raise a forward firewall',
  patrol: 'patrol quiet lanes',
  rebootNode: 'hard reset a hotspot',
  rebootNeighbor: 'reboot from the flank',
  hardenNode: 'harden a fragile node',
  recruitMid: 'request more mid support',
  recruitJunior: 'request more junior support',
  clearPathTo: 'clear a blocked route',
  idle: 'observe and wait',
};

function stablePrioritySort(rules: NetworkDefenseRule[], personality: NetworkDefensePersonality) {
  const order = new Map(personality.priorities.map((action, index) => [action, index]));
  return rules
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => {
      const pa = order.has(a.rule.action) ? order.get(a.rule.action) : Number.MAX_SAFE_INTEGER;
      const pb = order.has(b.rule.action) ? order.get(b.rule.action) : Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      return a.index - b.index;
    })
    .map(({ rule }) => ({ ...rule }));
}

export function pickRankPersonalities(rng: { pick: <T>(entries: T[]) => T }) {
  return Object.fromEntries(
    Object.entries(PERSONALITY_LIBRARY).map(([rank, entries]) => [rank, rng.pick(entries)])
  );
}

export function applyPersonalitiesToRules(
  baseRules: Record<string, NetworkDefenseRule[]>,
  rankPersonalities: Record<string, NetworkDefensePersonality>
) {
  return Object.fromEntries(
    Object.entries(baseRules).map(([rank, rules]) => {
      const personality = rankPersonalities[rank];
      if (!personality) return [rank, rules.map(rule => ({ ...rule }))];
      return [rank, stablePrioritySort(rules, personality)];
    })
  );
}

export function applyPersonalityToAgent(
  agent: NetworkDefenseAgent,
  rankPersonalities: Record<string, NetworkDefensePersonality>
) {
  const personality = rankPersonalities[agent.rank];
  agent.personality = personality;
  return agent;
}

export function describeAgentIntent(agent: NetworkDefenseAgent | undefined, fallbackIntent = 'observe the grid') {
  if (!agent) return fallbackIntent;
  if (agent.state === 'working') {
    return ACTION_LABELS[agent.arrivalAction] ?? fallbackIntent;
  }
  if (agent.state === 'moving') {
    return ACTION_LABELS[agent.actionKey] ?? fallbackIntent;
  }
  return fallbackIntent;
}

export function buildObserverSnapshot(
  agents: NetworkDefenseAgent[],
  rankPersonalities: Record<string, NetworkDefensePersonality>,
  rankIntents: Record<string, string>
): NetworkDefenseObserverSnapshot[] {
  return (['senior', 'mid', 'junior'] as NetworkDefenseRank[]).map((rank) => {
    const agent = agents.find(entry => entry.rank === rank);
    const personality = rankPersonalities[rank];
    return {
      rank,
      personality: personality?.label ?? 'Standard',
      summary: personality?.summary ?? 'balanced response',
      intent: describeAgentIntent(agent, rankIntents[rank] ?? 'observe the grid'),
    };
  });
}
