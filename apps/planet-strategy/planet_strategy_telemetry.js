export function reportPlanetStrategyTelemetry(payload) {
    const collapsedEmpires = (payload.scores ?? [])
        .filter((entry) => entry.collapsed)
        .map((entry) => entry.name);
    const enriched = {
        ...payload,
        collapsedEmpires,
        leaderboard: (payload.scores ?? []).map((entry, index) => ({
            rank: index + 1,
            ...entry,
        })),
        finalScores: payload.finalScores ?? payload.scores ?? [],
        telemetryVersion: 2,
    };
    window.Telemetry?.report('planet_strategy', enriched);
}
