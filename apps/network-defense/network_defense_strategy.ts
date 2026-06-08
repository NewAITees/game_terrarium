export function scanStrategyNetwork(topo: any, firewalls: Map<any, any>, enemyPackets: any[]) {
  const infected = topo.nodes.filter((node: any) => node.infection > 0.12).length;
  const critical = topo.nodes.filter((node: any) => node.infection > 0.65 || node.hp < node.maxHp * 0.45).length;
  const avgInfection = topo.nodes.reduce((sum: number, node: any) => sum + node.infection, 0) / topo.nodes.length;
  return { infected, critical, avgInfection, firewalls: firewalls.size, enemies: enemyPackets.length };
}

export function fallbackRule(snapshot: any, game: any, topo: any) {
  if (snapshot.critical > 5 || snapshot.avgInfection > 0.45) return 'containment';
  if (snapshot.enemies > 3 || game.wave >= 4) return 'firewall-first';
  if (snapshot.infected < 2 && topo.server.hp > 90) return 'patrol';
  return 'balanced';
}

export async function callStrategyLlm(snapshot: any, game: any, topo: any) {
  try {
    const res = await fetch('/api/strategy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`strategy ${res.status}`);
    const data = await res.json();
    if (data.rule) return data.rule;
  } catch (_) {
    // fallback below
  }
  return fallbackRule(snapshot, game, topo);
}
