import type {
  PlanetStrategyTelemetryPayload,
  PlanetStrategyTelemetryScore,
} from '../../shared/types/planet_strategy.js';

export function reportPlanetStrategyTelemetry(payload: PlanetStrategyTelemetryPayload): void {
  const collapsedEmpires = (payload.scores ?? [])
    .filter((entry: PlanetStrategyTelemetryScore) => entry.collapsed)
    .map((entry: PlanetStrategyTelemetryScore) => entry.name);
  const enriched = {
    ...payload,
    collapsedEmpires,
    leaderboard: (payload.scores ?? []).map((entry: PlanetStrategyTelemetryScore, index: number) => ({
      rank: index + 1,
      ...entry,
    })),
    finalScores: payload.finalScores ?? payload.scores ?? [],
    telemetryVersion: 2,
  };
  window.Telemetry?.report('planet_strategy', enriched);
}
