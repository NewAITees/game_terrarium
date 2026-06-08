import {
  AGENT_COSTS,
  AGENT_RANKS,
  DEFAULT_RULES,
  RULE_UPDATE_RANKS,
} from './network_defense_config.js';
import {
  buildRuleSnapshot,
  evalRuleCondition,
  loadAgentRules as loadNetworkDefenseRules,
  triggerRuleUpdate as triggerNetworkDefenseRuleUpdate,
} from './network_defense_rules.js';

export function createNetworkDefenseRuleRuntime(context: any) {
  let ruleUpdateRankIdx = 0;

  const baseAgentRules = {
    senior: [...DEFAULT_RULES.senior],
    mid: [...DEFAULT_RULES.mid],
    junior: [...DEFAULT_RULES.junior],
  };

  const agentRules = context.observerMode && context.rankPersonalities
    ? context.applyPersonalitiesToRules(baseAgentRules, context.rankPersonalities)
    : {
        senior: baseAgentRules.senior.map((rule: any) => ({ ...rule })),
        mid: baseAgentRules.mid.map((rule: any) => ({ ...rule })),
        junior: baseAgentRules.junior.map((rule: any) => ({ ...rule })),
      };

  function refreshAgentRules(): void {
    const nextRules = context.observerMode && context.rankPersonalities
      ? context.applyPersonalitiesToRules(baseAgentRules, context.rankPersonalities)
      : {
          senior: baseAgentRules.senior.map((rule: any) => ({ ...rule })),
          mid: baseAgentRules.mid.map((rule: any) => ({ ...rule })),
          junior: baseAgentRules.junior.map((rule: any) => ({ ...rule })),
        };
    for (const rank of Object.keys(nextRules)) {
      agentRules[rank] = nextRules[rank];
    }
  }

  async function triggerRuleUpdate(): Promise<void> {
    const rank = RULE_UPDATE_RANKS[ruleUpdateRankIdx % RULE_UPDATE_RANKS.length];
    ruleUpdateRankIdx++;

    const snapshot = {
      ...context.scanNetwork(),
      wave: context.game.wave,
      credits: Math.floor(context.game.credits),
      rule: context.game.rule,
      serverHp: Math.round(context.topo.server.hp),
    };

    await triggerNetworkDefenseRuleUpdate({
      rank,
      snapshot,
      currentRules: agentRules[rank],
      setStatus: context.setRuleStatus,
      setMessage: context.setMessage,
      logEvent: context.logEvent,
      reloadRules: loadAgentRules,
    });
  }

  async function loadAgentRules(): Promise<void> {
    await loadNetworkDefenseRules({
      baseAgentRules,
      refreshAgentRules,
      setStatus: context.setRuleStatus,
    });
  }

  function buildSnapshot(now: number): any {
    return buildRuleSnapshot({
      now,
      adj: context.adj,
      topo: context.topo,
      agents: context.agents,
      enemyPackets: context.enemyPackets,
      firewalls: context.firewalls,
      game: context.game,
    });
  }

  function execAction(agent: any, action: string, snapshot: any): boolean {
    switch (action) {
      case 'containServerNeighbor': {
        const threat = snapshot.serverNeighbors
          .filter((node: any) => node.infection > 0.1 && node.rebootUntil <= snapshot.now)
          .sort((a: any, b: any) => b.infection - a.infection)[0];
        if (!threat) return false;
        agent.actionKey = 'containServerNeighbor';
        return context.sendAgent(agent, threat);
      }
      case 'interceptEnemy': {
        const enemy = context.enemyPackets
          .filter((packet: any) => packet.path?.length > 1)
          .sort((a: any, b: any) => (b.path.length - b.seg) - (a.path.length - a.seg))[0];
        if (!enemy) return false;
        const idx = Math.max(enemy.seg, enemy.path.length - 3);
        agent.actionKey = 'interceptEnemy';
        return context.sendAgent(agent, enemy.path[idx], enemy.path[idx + 1] || null);
      }
      case 'suppressHottest': {
        const hot = context.hottestNode();
        if (!hot) return false;
        agent.actionKey = 'suppressHottest';
        return context.sendAgent(agent, hot);
      }
      case 'repairWeakest': {
        const damaged = context.weakestDamagedNode();
        if (!damaged) return false;
        agent.actionKey = 'repairWeakest';
        return context.sendAgent(agent, damaged);
      }
      case 'deployFirewallGuard': {
        const enemy = context.enemyPackets[0];
        if (!enemy?.path?.length) return false;
        const idx = Math.max(0, enemy.path.length - 2);
        agent.actionKey = 'deployFirewallGuard';
        return context.sendAgent(agent, enemy.path[idx], enemy.path[idx + 1] || null);
      }
      case 'patrol': {
        const target = context.patrolTarget();
        if (!target) return false;
        agent.actionKey = 'patrol';
        return context.sendAgent(agent, target);
      }
      case 'recruitMid': {
        const now = performance.now() / 1000;
        const pressure = snapshot.avgInfection > 0.3 || snapshot.serverHp < 70;
        const cooldown = pressure ? 1.0 : 3.0;
        const reserve = pressure ? 0 : 80;
        if (context.game.credits < AGENT_COSTS.mid + reserve || now - (context.game.lastRecruitTime || 0) < cooldown) return false;
        context.game.lastRecruitTime = now;
        context.buyAgent('mid');
        agent.cooldown = cooldown;
        return true;
      }
      case 'recruitJunior': {
        const now = performance.now() / 1000;
        const pressure = snapshot.avgInfection > 0.3 || snapshot.serverHp < 70;
        const cooldown = pressure ? 1.0 : 3.0;
        const reserve = pressure ? 0 : 50;
        if (context.game.credits < AGENT_COSTS.junior + reserve || now - (context.game.lastRecruitTime || 0) < cooldown) return false;
        context.game.lastRecruitTime = now;
        context.buyAgent('junior');
        agent.cooldown = cooldown;
        return true;
      }
      case 'clearPathTo': {
        const blocked = context.topo.nodes
          .filter((node: any) => !node.isServer && node.infection > 0.3)
          .sort((a: any, b: any) => b.infection - a.infection)[0];
        if (!blocked) return false;
        const neighbor = (context.adj.get(blocked.id) || [])
          .filter((node: any) => node.infection < 0.3 && node !== context.topo.server)
          .sort((a: any, b: any) => a.infection - b.infection)[0];
        if (!neighbor) return false;
        agent.actionKey = 'clearPathTo';
        agent.arrivalAction = 'rebootNeighbor';
        agent._rebootTarget = blocked;
        return context.sendAgent(agent, neighbor);
      }
      case 'hardenNode': {
        const now = performance.now() / 1000;
        const target = context.weakestDamagedNode() ?? context.hottestNode();
        if (!target || target.hardenUntil > now) return false;
        agent.actionKey = 'hardenNode';
        agent.arrivalAction = 'harden';
        return context.sendAgent(agent, target);
      }
      case 'rebootNode': {
        const now = performance.now() / 1000;
        const target = context.hottestNode();
        if (!target || target.rebootUntil > now) return false;
        agent.actionKey = 'rebootNode';
        agent.arrivalAction = 'reboot';
        return context.sendAgent(agent, target);
      }
      case 'idle':
        agent.cooldown = AGENT_RANKS[agent.rank].cooldown;
        return true;
      default:
        return false;
    }
  }

  function runAgentRules(agent: any, snapshot: any): void {
    for (const rule of agentRules[agent.rank] ?? []) {
      if (rule.when && !evalRuleCondition(rule.when, snapshot)) continue;
      if (execAction(agent, rule.action, snapshot)) {
        if (context.observerMode) context.game.rankIntents[agent.rank] = rule.id ?? rule.action;
        context.logEvent(`${agent.rank} › ${rule.id ?? rule.action}`, 'agent');
        context.game.waveActions[agent.rank] = (context.game.waveActions[agent.rank] || 0) + 1;
        return;
      }
    }

    const currentNode = agent.currentNode;
    if (currentNode && currentNode !== context.topo.server && currentNode.infection > 0.15) {
      currentNode.infection = Math.max(0, currentNode.infection - 0.28);
      currentNode.hp = Math.min(currentNode.maxHp, currentNode.hp + 15);
      if (context.observerMode) context.game.rankIntents[agent.rank] = 'self-repair current sector';
      agent.cooldown = 0.8;
      return;
    }

    if (context.observerMode) context.game.rankIntents[agent.rank] = 'scan for the next opening';
    agent.cooldown = AGENT_RANKS[agent.rank].cooldown + context.rng.next() * 0.5;
  }

  function assignAgent(agent: any): void {
    runAgentRules(agent, buildSnapshot(performance.now() / 1000));
  }

  return {
    agentRules,
    assignAgent,
    loadAgentRules,
    triggerRuleUpdate,
  };
}
