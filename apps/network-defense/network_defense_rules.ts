export const SNAP_KEYS = [
  'hottestInfection', 'avgInfection', 'serverHp', 'serverNeighborMaxInfection',
  'enemyCount', 'infectedCount', 'firewallCount', 'gameRule', 'wave', 'credits',
  'seniorCount', 'midCount', 'juniorCount', 'totalAgents',
];

export function buildRuleSnapshot({
  now,
  adj,
  topo,
  agents,
  enemyPackets,
  firewalls,
  game,
}: {
  now: number;
  adj: Map<number, any[]>;
  topo: any;
  agents: any[];
  enemyPackets: any[];
  firewalls: Map<any, any>;
  game: any;
}) {
  const serverNeighbors = adj.get(topo.server.id) || [];
  const allInfected = topo.nodes.filter((n: any) => n.infection > 0.08);
  const agentCounts = agents.reduce((acc: any, a: any) => {
    acc[a.rank] = (acc[a.rank] || 0) + 1;
    return acc;
  }, {});
  return {
    now,
    serverNeighbors,
    serverNeighborMaxInfection: serverNeighbors.reduce((m: number, n: any) => Math.max(m, n.infection), 0),
    hottestInfection: topo.nodes.reduce((m: number, n: any) => Math.max(m, n.infection), 0),
    avgInfection: topo.nodes.reduce((s: number, n: any) => s + n.infection, 0) / topo.nodes.length,
    serverHp: topo.server.hp,
    enemyCount: enemyPackets.length,
    infectedCount: allInfected.length,
    firewallCount: firewalls.size,
    gameRule: game.rule,
    wave: game.wave,
    credits: game.credits,
    seniorCount: agentCounts.senior || 0,
    midCount: agentCounts.mid || 0,
    juniorCount: agentCounts.junior || 0,
    totalAgents: agents.length,
  };
}

export function evalRuleCondition(when: any, snap: Record<string, any>) {
  if (typeof when === 'string') {
    try {
      return new Function(...SNAP_KEYS, `return !!(${when});`)(...SNAP_KEYS.map((k) => snap[k]));
    } catch (e: any) {
      console.warn('[agent rule] condition error:', e.message, '|', when);
      return false;
    }
  }

  for (const [key, val] of Object.entries(when)) {
    switch (key) {
      case 'serverNeighborInfection':
        if (snap.serverNeighborMaxInfection <= val) return false; break;
      case 'hottestInfection':
        if (snap.hottestInfection <= val) return false; break;
      case 'avgInfection':
        if (snap.avgInfection <= val) return false; break;
      case 'enemyCount':
        if (snap.enemyCount < val) return false; break;
      case 'infectedCount':
        if (snap.infectedCount < val) return false; break;
      case 'serverHpBelow':
        if (snap.serverHp >= val) return false; break;
      case 'waveGte':
        if (snap.wave < val) return false; break;
      case 'gameRule':
        if (snap.gameRule !== val) return false; break;
      case 'gameRuleNot':
        if (snap.gameRule === val) return false; break;
      case 'creditsGte':
        if (snap.credits < val) return false; break;
    }
  }
  return true;
}

export async function triggerRuleUpdate({
  rank,
  snapshot,
  currentRules,
  setStatus,
  setMessage,
  logEvent,
  reloadRules,
}: {
  rank: string;
  snapshot: any;
  currentRules: any[];
  setStatus: (text: string) => void;
  setMessage: (text: string) => void;
  logEvent: (text: string, type?: string) => void;
  reloadRules: () => Promise<void>;
}) {
  setStatus(`rules: asking ollama for ${rank}…`);
  try {
    const res = await fetch('/api/update-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank, snapshot, currentRules }),
      signal: AbortSignal.timeout(22000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setStatus(`rules: ollama rewrote ${rank} (${data.ruleCount} rules)`);
    setMessage(`Ollama updated ${rank} agent rules (wave ${snapshot.wave}).`);
    logEvent(`Ollama rewrote ${rank} rules (${data.ruleCount} rules)`, 'ollama');
    await reloadRules();
  } catch (err: any) {
    setStatus(`rules: update failed — ${err.message}`);
    logEvent(`Ollama update failed: ${err.message}`, 'info');
  }
}

export async function loadAgentRules({
  baseAgentRules,
  refreshAgentRules,
  setStatus,
}: {
  baseAgentRules: Record<string, any[]>;
  refreshAgentRules: () => void;
  setStatus: (text: string) => void;
}) {
  let anyLoaded = false;
  for (const rank of ['senior', 'mid', 'junior']) {
    try {
      const res = await fetch(`./agent_rules/${rank}.json?t=${Date.now()}`);
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data.rules)) {
        baseAgentRules[rank] = data.rules.map((rule: any) => ({ ...rule }));
        anyLoaded = true;
      }
    } catch (_) {
      // keep existing rules on fetch failure
    }
  }
  refreshAgentRules();
  if (anyLoaded) {
    setStatus(`rules: loaded ${new Date().toLocaleTimeString()}`);
  }
}
