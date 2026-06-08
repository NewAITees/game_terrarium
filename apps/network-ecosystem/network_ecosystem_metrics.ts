import type {
  EcosystemGameState,
  EcosystemHotspot,
  EcosystemSnapshot,
  EcosystemTotals,
  EcosystemPulse,
} from '../../shared/types/network_ecosystem.js';

function aggregateTotals(topo: any): EcosystemTotals {
  return topo.nodes.reduce((acc: EcosystemTotals, node: any) => {
    acc.resource += node.resource;
    acc.threat += node.threat;
    acc.immune += node.immune;
    acc.carnivore += node.carnivore;
    return acc;
  }, { resource: 0, threat: 0, immune: 0, carnivore: 0 });
}

export function balanceScore(totals: EcosystemTotals, count: number): number {
  const avgResource = totals.resource / count;
  const avgThreat = totals.threat / count;
  const avgImmune = totals.immune / count;
  const avgCarnivore = totals.carnivore / count;
  const targetThreat = 0.16;
  const targetCarnivore = 0.22;
  const activityPenalty = Math.abs(avgThreat - targetThreat) * 0.9 + Math.abs(avgCarnivore - targetCarnivore) * 0.9;
  const immunePenalty = Math.max(0, avgImmune - 0.24) * 0.45;
  const resourcePenalty = Math.max(0, 0.58 - avgResource) * 0.7;
  const overgrowthPenalty = Math.max(0, avgThreat + avgCarnivore - 0.55) * 0.55;
  return Math.max(0, Math.min(1, 0.92 - activityPenalty - immunePenalty - resourcePenalty - overgrowthPenalty));
}

export function buildEcosystemSnapshot(
  topo: any,
  pulses: EcosystemPulse[],
  game: EcosystemGameState,
): EcosystemSnapshot {
  const totals = aggregateTotals(topo);
  const count = topo.nodes.length;
  const balance = balanceScore(totals, count);
  const hotspots: EcosystemHotspot[] = topo.nodes
    .filter((node: any) => node.threat > 0.18 || node.carnivore > 0.18 || node.resource < 0.35)
    .sort((a: any, b: any) => (b.threat + b.carnivore - b.resource * 0.35) - (a.threat + a.carnivore - a.resource * 0.35))
    .slice(0, 6)
    .map((node: any) => ({
      id: node.id,
      layer: node.isServer ? 'server' : node.layer,
      resource: Number(node.resource.toFixed(3)),
      threat: Number(node.threat.toFixed(3)),
      immune: Number(node.immune.toFixed(3)),
      carnivore: Number(node.carnivore.toFixed(3)),
    }));

  return {
    elapsed: Math.round(game.elapsed),
    mode: game.mode,
    nodes: count,
    balance: Math.round(balance * 100),
    idealBalanceRange: [70, 90],
    avgResource: Number((totals.resource / count).toFixed(3)),
    avgThreat: Number((totals.threat / count).toFixed(3)),
    avgImmune: Number((totals.immune / count).toFixed(3)),
    avgCarnivore: Number((totals.carnivore / count).toFixed(3)),
    activeNodes: topo.nodes.filter((node: any) => node.threat > 0.05 || node.carnivore > 0.05).length,
    coexistNodes: topo.nodes.filter((node: any) => node.threat > 0.05 && node.carnivore > 0.05).length,
    activePulses: pulses.length,
    hotspots,
  };
}

export function reportEcosystemTelemetry(
  topo: any,
  pulses: EcosystemPulse[],
  game: EcosystemGameState,
): void {
  window.Telemetry?.report('network_ecosystem', buildEcosystemSnapshot(topo, pulses, game));
}
