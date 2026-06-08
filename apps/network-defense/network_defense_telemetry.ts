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
