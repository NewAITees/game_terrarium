export function buildObserverHotspots(topo: any) {
  return topo.nodes
    .filter((node: any) => !node.isServer)
    .sort((a: any, b: any) => (b.infection + (1 - b.hp / b.maxHp)) - (a.infection + (1 - a.hp / a.maxHp)))
    .slice(0, 3)
    .map((node: any) => ({
      label: `${node.layer.toUpperCase()} ${node.id}`,
      value: `inf ${Math.round(node.infection * 100)} / hp ${Math.round(node.hp)}`,
    }));
}

export function buildObserverSummary(topo: any, enemyPackets: any[], defensePackets: any[]) {
  const hotspots = buildObserverHotspots(topo);
  const hottest = topo.nodes.reduce((best: any, node: any) => (node.infection > best.infection ? node : best), topo.nodes[0]);
  if (topo.server.hp < 70) {
    return {
      text: 'The server core is taking visible pressure.',
      detail: 'Defenders are being forced into emergency containment.',
    };
  }
  if (enemyPackets.length > defensePackets.length + 2) {
    return {
      text: 'Enemy packet flow is outrunning the local defense rhythm.',
      detail: 'Watch the front line before the next wave compounds it.',
    };
  }
  if ((hottest?.infection ?? 0) > 0.48) {
    return {
      text: `Infection pressure is peaking around node ${hottest.id}.`,
      detail: 'A single unstable cluster is shaping the whole grid.',
    };
  }
  if (hotspots.length) {
    return {
      text: 'Defense is holding, but a few lanes are still running hot.',
      detail: `Top pressure point: ${hotspots[0].label}.`,
    };
  }
  return {
    text: 'The grid is stable enough for personalities to shape the flow.',
    detail: 'Most interesting changes are now coming from route choices and event timing.',
  };
}

export function observerPulseCalm(topo: any, setMessage: (text: string) => void, logEvent: (text: string, type?: string) => void) {
  const targets = topo.nodes
    .filter((node: any) => !node.isServer)
    .sort((a: any, b: any) => b.infection - a.infection)
    .slice(0, 3);
  if (!targets.length) return;
  for (const node of targets) {
    node.infection = Math.max(0, node.infection - 0.18);
    node.hardenUntil = Math.max(node.hardenUntil, performance.now() / 1000 + 6);
  }
  setMessage('Observer intervention: Pulse Calm cooled the hottest sectors.');
  logEvent('Observer: Pulse Calm reduced infection on the top pressure nodes.', 'player');
}

export function observerBreachSpike(topo: any, setMessage: (text: string) => void, logEvent: (text: string, type?: string) => void) {
  const targets = topo.nodes
    .filter((node: any) => !node.isServer && node.infection < 0.45)
    .sort((a: any, b: any) => b.degree - a.degree)
    .slice(0, 2);
  if (!targets.length) return;
  for (const node of targets) {
    node.infection = Math.min(1, node.infection + 0.26);
    node.targetedUntil = performance.now() / 1000 + 8;
  }
  setMessage('Observer intervention: Breach Spike forced a new frontline.');
  logEvent('Observer: Breach Spike created a fresh infection spike.', 'player');
}
