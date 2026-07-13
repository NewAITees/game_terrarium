export function reportNetworkDefenseTelemetry({
  topo,
  game,
  enemyPackets,
  defensePackets,
  normalPackets,
  agents,
  firewalls,
  observerMode,
  observationEvents,
  rankPersonalities,
}: {
  topo: any;
  game: any;
  enemyPackets: any[];
  defensePackets: any[];
  normalPackets: any[];
  agents: any[];
  firewalls: Map<any, any>;
  observerMode: boolean;
  observationEvents: { getHudState: () => { label: string } };
  rankPersonalities: Record<string, any> | null;
}): void {
  const totals = topo.nodes.reduce((acc: any, node: any) => {
    acc.hp += node.hp;
    acc.infection += node.infection;
    if (node.infection > 0.08) acc.infected += 1;
    return acc;
  }, { hp: 0, infection: 0, infected: 0 });
  const count = topo.nodes.length;
  const serverHpRatio = topo.server?.maxHp ? topo.server.hp / topo.server.maxHp : 0;
  const infectionRate = count > 0 ? totals.infected / count : 0;
  const hotspots = topo.nodes
    .filter((node: any) => node.infection > 0.12 || node.hp < node.maxHp * 0.72)
    .sort((a: any, b: any) => b.infection - a.infection || a.hp - b.hp)
    .slice(0, 5)
    .map((node: any) => ({
      id: node.id,
      layer: node.isServer ? 'server' : node.layer,
      hp: Math.round(node.hp),
      infection: Number(node.infection.toFixed(3)),
    }));
  const agentRanks = agents.reduce((acc: any, agent: any) => {
    acc[agent.rank] = (acc[agent.rank] || 0) + 1;
    return acc;
  }, {});
  const packetBalance = (enemyPackets.length + normalPackets.length + defensePackets.length) / Math.max(1, count);
  const defenseCoverage = defensePackets.length / Math.max(1, enemyPackets.length + defensePackets.length);
  const stability = Math.max(0, Math.min(1, serverHpRatio * 0.6 + (1 - infectionRate) * 0.4));
  const pressure = Math.max(0, Math.min(1, infectionRate * 0.7 + packetBalance * 0.2 + (1 - defenseCoverage) * 0.1));
  const momentum = Math.max(0, Math.min(1, (game.kills / Math.max(1, game.elapsed || 1)) / 0.8));
  const activity = Math.max(0, Math.min(1, (enemyPackets.length + defensePackets.length + normalPackets.length) / Math.max(1, count * 1.5)));
  const health = Math.max(0, Math.min(1, (stability + (1 - pressure)) / 2));
  const risk = Math.max(0, Math.min(1, pressure + (1 - serverHpRatio) * 0.4));
  const fun = Math.max(0, Math.min(1, 0.2 + activity * 0.35 + (1 - Math.abs(stability - pressure)) * 0.45));

  const payload: Record<string, any> = {
    elapsed: Math.round(game.elapsed),
    gameOver: game.gameOver,
    kills: game.kills,
    score: game.score,
    credits: Math.floor(game.credits),
    wave: game.wave,
    waveRemaining: game.waveRemaining,
    rule: game.rule,
    seniorAlive: game.seniorAlive,
    mode: game.mode,
    serverHp: Math.max(0, Math.round(topo.server.hp)),
    nodes: count,
    infectedNodes: totals.infected,
    avgHp: Math.round(totals.hp / count),
    avgInfection: Number((totals.infection / count).toFixed(3)),
    packets: {
      enemy: enemyPackets.length,
      defense: defensePackets.length,
      normal: normalPackets.length,
      agents: agents.filter((agent: any) => agent.state !== 'idle').length,
      firewalls: firewalls.size,
    },
    agentRanks,
    hotspots,
    analysis: {
      phase: observerMode ? 'observer_defense' : 'network_defense',
      progress: Math.max(0, Math.min(1, game.elapsed / 240)),
      health,
      stability,
      pressure,
      momentum,
      activity,
      risk,
      fun,
      summary: `${count} nodes, ${totals.infected} infected, ${enemyPackets.length} enemy packets`,
      signals: [
        { key: 'serverHpRatio', value: serverHpRatio, target: 1, weight: 1.1 },
        { key: 'infectionRate', value: infectionRate, target: 0, weight: 1.1 },
        { key: 'defenseCoverage', value: defenseCoverage, target: 0.6, weight: 0.8 },
        { key: 'packetBalance', value: packetBalance, target: 0.25, weight: 0.7 },
      ],
      highlights: hotspots.map((hotspot: any) => `${hotspot.layer}:${hotspot.id} hp ${hotspot.hp} inf ${hotspot.infection}`),
      details: {
        nodes: count,
        infectedNodes: totals.infected,
        serverHpRatio: Number(serverHpRatio.toFixed(3)),
        infectionRate: Number(infectionRate.toFixed(3)),
        packetBalance: Number(packetBalance.toFixed(3)),
        defenseCoverage: Number(defenseCoverage.toFixed(3)),
        agentCount: agents.length,
        activeAgentCount: agents.filter((agent: any) => agent.state !== 'idle').length,
      },
    },
  };
  if (observerMode && rankPersonalities) {
    payload.observer = {
      lowLoadMode: game.lowLoadMode,
      event: observationEvents.getHudState().label,
      personalities: Object.fromEntries(
        Object.entries(rankPersonalities).map(([rank, personality]) => [rank, (personality as any).label])
      ),
      intents: game.rankIntents,
    };
  }
  window.Telemetry?.report(observerMode ? 'network_defense_observer' : 'network_defense', payload);
}
