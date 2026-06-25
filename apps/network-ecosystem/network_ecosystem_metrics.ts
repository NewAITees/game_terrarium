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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
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
): EcosystemSnapshot & { analysis: Record<string, any> } {
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
  const activeNodes = topo.nodes.filter((node: any) => node.threat > 0.05 || node.carnivore > 0.05).length;
  const coexistNodes = topo.nodes.filter((node: any) => node.threat > 0.05 && node.carnivore > 0.05).length;
  const pulseMix = pulses.reduce((acc: Record<string, number>, pulse: EcosystemPulse) => {
    acc[pulse.pulseType] = (acc[pulse.pulseType] || 0) + 1;
    return acc;
  }, {});
  const pulseThreat = pulseMix.threat || 0;
  const pulseCarnivore = pulseMix.carnivore || 0;
  const pulseImmune = pulseMix.immune || 0;
  const activity = clamp01((activeNodes + pulses.length) / Math.max(1, count * 1.2));
  const stability = clamp01(balance);
  const pressure = clamp01((totals.threat + totals.carnivore) / Math.max(1, count * 0.55));
  const momentum = clamp01((game.elapsed / 180) * 0.35 + (pulseThreat + pulseCarnivore) / Math.max(1, pulses.length || 1));
  const health = clamp01((stability + (1 - pressure)) / 2);
  const risk = clamp01(1 - balance + Math.max(0, pressure - 0.55));
  const fun = clamp01(0.2 + balance * 0.4 + activity * 0.25 + coexistNodes / Math.max(1, count) * 0.15);

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
    activeNodes,
    coexistNodes,
    activePulses: pulses.length,
    hotspots,
    analysis: {
      phase: game.mode,
      progress: clamp01(game.elapsed / 240),
      health,
      stability,
      pressure,
      momentum,
      activity,
      risk,
      fun,
      summary: `${count} nodes, balance ${Math.round(balance * 100)}%, ${pulses.length} active pulses`,
      signals: [
        { key: 'balance', value: balance, target: 0.8, weight: 1.1 },
        { key: 'avgThreat', value: totals.threat / Math.max(1, count), target: 0.16, weight: 0.8 },
        { key: 'avgCarnivore', value: totals.carnivore / Math.max(1, count), target: 0.22, weight: 0.8 },
        { key: 'coexistNodes', value: coexistNodes, target: 0, weight: 0.6 },
      ],
      highlights: hotspots.map((hotspot) => `${hotspot.layer}:${hotspot.id} R${hotspot.resource} T${hotspot.threat} C${hotspot.carnivore}`),
      details: {
        activeNodes,
        coexistNodes,
        activePulses: pulses.length,
        pulseThreat,
        pulseCarnivore,
        pulseImmune,
      },
    },
  };
}

export function reportEcosystemTelemetry(
  topo: any,
  pulses: EcosystemPulse[],
  game: EcosystemGameState,
): void {
  window.Telemetry?.report('network_ecosystem', buildEcosystemSnapshot(topo, pulses, game));
}

