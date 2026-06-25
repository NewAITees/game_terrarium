import type {
  PlanetStrategyTelemetryPayload,
  PlanetStrategyTelemetryScore,
} from '../../shared/types/planet_strategy.js';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

export function reportPlanetStrategyTelemetry(payload: PlanetStrategyTelemetryPayload): void {
  const collapsedEmpires = (payload.scores ?? [])
    .filter((entry: PlanetStrategyTelemetryScore) => entry.collapsed)
    .map((entry: PlanetStrategyTelemetryScore) => entry.name);
  const leaderboard = (payload.scores ?? []).map((entry: PlanetStrategyTelemetryScore, index: number) => ({
    rank: index + 1,
    ...entry,
  }));
  const activeScores = (payload.scores ?? []).filter((entry: PlanetStrategyTelemetryScore) => !entry.collapsed);
  const scoreValues = (payload.scores ?? []).map((entry: PlanetStrategyTelemetryScore) => entry.total || 0);
  const scoreSpread = scoreValues.length > 1 ? Math.max(...scoreValues) - Math.min(...scoreValues) : 0;
  const activeEmpireCount = (payload.empires ?? []).filter((empire: any) => !collapsedEmpires.includes(empire.name)).length;
  const transportTotal = sum((payload.empires ?? []).map((empire: any) => empire.transports || 0));
  const stockTotal = sum((payload.empires ?? []).map((empire: any) => empire.stock || 0));
  const totalShips = payload.ships || 0;
  const totalPlanets = payload.planets || 0;
  const progress = clamp01((payload.elapsed || 0) / Math.max(1, payload.matchForceEndSeconds || 1));
  const deliveryRate = (payload.elapsed || 0) > 0 ? (payload.deliveredTotal || 0) / payload.elapsed : 0;
  const productionRate = (payload.elapsed || 0) > 0 ? (payload.minedTotal || 0) / payload.elapsed : 0;
  const collapseRate = (payload.empires ?? []).length ? collapsedEmpires.length / (payload.empires ?? []).length : 0;
  const balance = clamp01(1 - Math.min(1, scoreSpread / Math.max(1, sum(scoreValues) || 1)));
  const momentum = clamp01(Math.min(1, deliveryRate / 2) * 0.65 + Math.min(1, productionRate / 3) * 0.35);
  const stability = clamp01(1 - collapseRate * 0.85 + balance * 0.15);
  const pressure = clamp01((payload.depletedPlanets || 0) / Math.max(1, totalPlanets) + collapseRate * 0.2);
  const health = clamp01((stability + balance) / 2);
  const activity = clamp01((totalShips + transportTotal) / Math.max(1, totalPlanets * 3));
  const risk = clamp01(pressure * 0.7 + collapseRate * 0.4);
  const fun = clamp01(0.2 + activity * 0.2 + momentum * 0.25 + (1 - balance) * 0.35);

  const enriched = {
    ...payload,
    collapsedEmpires,
    leaderboard,
    activeScores,
    finalScores: payload.finalScores ?? payload.scores ?? [],
    telemetryVersion: 3,
    analysis: {
      phase: payload.gameOver ? 'finished' : 'campaign',
      progress,
      health,
      stability,
      pressure,
      momentum,
      activity,
      risk,
      fun,
      summary: `${totalPlanets} planets, ${totalShips} ships, ${collapsedEmpires.length} collapsed empires`,
      signals: [
        { key: 'collapseRate', value: collapseRate, target: 0, weight: 1.2 },
        { key: 'scoreSpread', value: scoreSpread, target: 0, weight: 0.9 },
        { key: 'deliveryRate', value: deliveryRate, target: 1.5, weight: 0.8 },
        { key: 'productionRate', value: productionRate, target: 2, weight: 0.7 },
      ],
      highlights: leaderboard.slice(0, 3).map((row) => `${row.rank}. ${row.name} ${row.total}`),
      details: {
        elapsed: payload.elapsed,
        ships: totalShips,
        planets: totalPlanets,
        collapsedEmpires: collapsedEmpires.length,
        activeEmpires: activeEmpireCount,
        transportTotal,
        stockTotal,
        deliveryRate: Number(deliveryRate.toFixed(3)),
        productionRate: Number(productionRate.toFixed(3)),
        scoreSpread: Number(scoreSpread.toFixed(3)),
      },
    },
  };
  window.Telemetry?.report('planet_strategy', enriched);
}
