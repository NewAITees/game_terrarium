import { reportPlanetStrategyTelemetry } from './planet_strategy_telemetry.js';

export function createPlanetStrategyMatchRuntime(context: any) {
  function buildWorldSummary() {
    if (context.world.gameOver) {
      return {
        text: context.world.finalSummary || 'Match finished.',
        detail: context.world.finalDetail || 'The empires have stopped competing.',
        busiest: [...context.world.routes.values()].sort((a, b) => b.traffic - a.traffic)[0],
      };
    }
    const busiest = [...context.world.routes.values()].sort((a, b) => b.traffic - a.traffic)[0];
    const starvedFactories = context.world.planets.filter((planet: any) => planet.type === 'factory' && planet.stock < 10).length;
    const depleted = context.world.planets.filter((planet: any) => planet.resources <= 0).length;
    let text = 'Empires are stretching ore lanes across the sector.';
    let detail = `${starvedFactories} factories are running thin.`;
    if (starvedFactories >= 2) {
      text = 'Ore starvation is starting to bite into factory output.';
      detail = 'Transport allocation is lagging behind demand.';
    } else if ((busiest?.traffic ?? 0) > 10) {
      text = 'A few core routes are carrying most of the sector traffic.';
      detail = 'Watching those lanes explains the current balance.';
    } else if (depleted > 0) {
      text = 'Some planets have already burned through their easy ore.';
      detail = 'Empire routes will need to adapt soon.';
    }
    return { text, detail, busiest };
  }

  function computeVictoryScores() {
    return context.world.empires.map((empire: any) => {
      const planets = context.world.planets.filter((planet: any) => planet.owner === empire.id).length;
      const deliveredScore = empire.delivered / 10;
      const producedScore = empire.producedShips * 20;
      const planetScore = planets * 30;
      const survivalBonus = empire.collapsed ? 0 : 40;
      return {
        id: empire.id,
        name: empire.name,
        collapsed: empire.collapsed,
        deliveredScore,
        producedScore,
        planetScore,
        survivalBonus,
        total: producedScore + deliveredScore + planetScore + survivalBonus,
      };
    }).sort((a: any, b: any) => b.total - a.total);
  }

  function collapseEmpire(empire: any, reason: string) {
    if (empire.collapsed) return;
    empire.collapsed = true;
    empire.collapseReason = reason;
    empire.intent = `collapsed: ${reason}`;
    context.maybeLog(`collapse:${empire.id}`, `${empire.name} collapsed after it ${reason}.`, 'warning', 999);
  }

  function evaluateEmpireCollapse() {
    for (const empire of context.world.empires) {
      if (empire.collapsed) continue;
      const ownedPlanets = context.world.planets.filter((planet: any) => planet.owner === empire.id).length;
      const transports = context.world.ships.filter((ship: any) => ship.owner === empire.id && ship.kind === 'transport').length;
      const factory = context.getPlanet(empire.homeFactoryId);
      if (factory && factory.owner !== empire.id) collapseEmpire(empire, 'lost its factory planet');
      else if (ownedPlanets <= 0) collapseEmpire(empire, 'lost all planets');
      else if (transports <= 0) collapseEmpire(empire, 'lost all transport ships');
      else if (factory?.stalled && empire.stalledTime >= context.factoryStallCollapseSeconds) {
        collapseEmpire(empire, 'kept its factory stalled too long');
      }
    }
  }

  function finalizeMatch(reason: string) {
    if (context.world.gameOver) return;
    const scores = computeVictoryScores();
    const winner = scores[0] ?? null;
    const busiest = [...context.world.routes.values()].sort((a, b) => b.traffic - a.traffic)[0];
    context.world.gameOver = true;
    context.world.endReason = reason;
    context.world.winnerId = winner?.id ?? null;
    context.world.finalScores = scores;
    context.world.finalSummary = winner
      ? `${winner.name} wins the sector through logistics efficiency.`
      : 'No empire could secure the sector.';
    context.world.finalDetail = busiest
      ? `Top lane: ${busiest.fromPlanetId} ⇄ ${busiest.toPlanetId}.`
      : 'No stable route survived to the finish.';
    context.maybeLog('match:end', context.world.finalSummary, 'empire', 999);
  }

  function evaluateMatchState() {
    if (context.world.gameOver) return;
    if (context.world.time >= 300 && context.world.oreFalloffStart === null) {
      context.world.oreFalloffStart = context.world.time;
      context.logEvent('Sector ore veins exhausted — mining rates collapsing for 20 seconds.', 'warning');
    }
    const alive = context.world.empires.filter((empire: any) => !empire.collapsed);
    if (alive.length <= 1) {
      finalizeMatch('collapse');
      return;
    }
    const scores = computeVictoryScores();
    const leadGap = (scores[0]?.total ?? 0) - (scores[1]?.total ?? 0);
    if (context.world.time >= context.matchEndSeconds && leadGap > context.tieBreakDelta) {
      finalizeMatch('time');
    } else if (context.world.time >= context.matchForceEndSeconds) {
      finalizeMatch('forced');
    }
  }

  function updateHud() {
    const summary = buildWorldSummary();
    const scores = context.world.gameOver ? context.world.finalScores : computeVictoryScores();
    const topDelivery = [...context.world.empires].sort((a: any, b: any) => b.delivered - a.delivered)[0] ?? null;
    context.ui.update({
      elapsed: Math.floor(context.world.time),
      planets: context.world.planets.length,
      ships: context.world.ships.length,
      mined: Math.floor(context.world.minedTotal),
      moved: Math.floor(context.world.deliveredTotal),
      depleted: context.world.planets.filter((planet: any) => planet.resources <= 0).length,
      kills: context.world.kills,
      summaryText: summary.text,
      summaryDetail: summary.detail,
      busiestRoute: summary.busiest
        ? `${summary.busiest.fromPlanetId} ⇄ ${summary.busiest.toPlanetId}  traffic ${summary.busiest.traffic.toFixed(1)}`
        : 'No route established yet.',
      busiestRouteLabel: summary.busiest
        ? `${summary.busiest.fromPlanetId} ⇄ ${summary.busiest.toPlanetId}`
        : null,
      phaseLine: context.world.gameOver
        ? `Match complete at ${Math.floor(context.world.time)}s.`
        : context.world.time < context.matchEndSeconds
          ? `Running toward ${context.matchEndSeconds}s regulation.`
          : `Overtime until ${context.matchForceEndSeconds}s force end.`,
      winnerLine: context.world.gameOver
        ? (scores[0] ? `${scores[0].name} won with ${Math.round(scores[0].total)} points.` : 'No winner decided.')
        : 'Winner not decided yet.',
      statusDetail: context.world.gameOver
        ? summary.detail
        : `${context.world.empires.filter((empire: any) => empire.collapsed).length} empires collapsed so far.`,
      gameOver: context.world.gameOver,
      winnerName: scores[0]?.name ?? null,
      topDeliveryEmpire: topDelivery?.name ?? null,
      depletedCount: context.world.planets.filter((planet: any) => planet.resources <= 0).length,
      scoreRows: scores.slice(0, 3).map((score: any) => ({
        name: score.name,
        collapsed: score.collapsed,
        value: Math.round(score.total),
      })),
      empireRows: context.world.empires.map((empire: any) => {
        const planets = context.world.planets.filter((planet: any) => planet.owner === empire.id);
        const stock = planets.reduce((sum: number, planet: any) => sum + planet.stock, 0);
        const transports = context.world.ships.filter((ship: any) => ship.owner === empire.id).length;
        return {
          color: empire.color,
          name: empire.name,
          intent: empire.intent,
          numbers: `${planets.length}p / ${transports}s / ${Math.floor(stock)} ore${empire.collapsed ? ' / dead' : ''}`,
        };
      }),
    });
  }

  function reportTelemetry() {
    const summary = buildWorldSummary();
    const scores = computeVictoryScores();
    const empires = context.world.empires.map((empire: any) => {
      const planets = context.world.planets.filter((planet: any) => planet.owner === empire.id);
      return {
        id: empire.id,
        name: empire.name,
        personality: empire.personality,
        planets: planets.length,
        stock: Math.round(planets.reduce((sum: number, planet: any) => sum + planet.stock, 0)),
        transports: context.world.ships.filter((ship: any) => ship.owner === empire.id).length,
        intent: empire.intent,
      };
    });
    reportPlanetStrategyTelemetry({
      elapsed: Math.round(context.world.time),
      matchEndSeconds: context.matchEndSeconds,
      matchForceEndSeconds: context.matchForceEndSeconds,
      planets: context.world.planets.length,
      ships: context.world.ships.length,
      minedTotal: Math.round(context.world.minedTotal),
      deliveredTotal: Math.round(context.world.deliveredTotal),
      depletedPlanets: context.world.planets.filter((planet: any) => planet.resources <= 0).length,
      gameOver: context.world.gameOver,
      endReason: context.world.endReason,
      winnerId: context.world.winnerId,
      empires,
      scores: scores.map((entry: any) => ({
        id: entry.id,
        name: entry.name,
        total: Math.round(entry.total),
        collapsed: entry.collapsed,
        breakdown: {
          deliveredScore: Math.round(entry.deliveredScore),
          producedScore: Math.round(entry.producedScore),
          planetScore: Math.round(entry.planetScore),
          survivalBonus: Math.round(entry.survivalBonus),
        },
      })),
      finalScores: context.world.finalScores.map((entry: any) => ({
        id: entry.id,
        name: entry.name,
        total: Math.round(entry.total),
        collapsed: entry.collapsed,
      })),
      busiestRoute: summary.busiest
        ? {
            from: summary.busiest.fromPlanetId,
            to: summary.busiest.toPlanetId,
            traffic: Number(summary.busiest.traffic.toFixed(2)),
          }
        : null,
      summary: { text: summary.text, detail: summary.detail },
    });
  }

  return {
    buildWorldSummary,
    collapseEmpire,
    computeVictoryScores,
    evaluateEmpireCollapse,
    evaluateMatchState,
    finalizeMatch,
    reportTelemetry,
    updateHud,
  };
}
