import type { PlanetStrategyAiStrategy } from '../../shared/types/planet_strategy.js';
import { baseGoalWeights, combineGoalWeights, goalLabel, pickGoal } from './planet_strategy_ai_goals.js';

export const updateStrategy: PlanetStrategyAiStrategy = (empire, ctx) => {
  const { world, getPlanet, distance3d, queueConstruction, rng } = ctx;
  const factory     = getPlanet(empire.homeFactoryId);
  const ownShips    = world.ships.filter(s => s.owner === empire.id);
  const ownedMines  = world.planets.filter(p => p.owner === empire.id && p.structures.mine > 0);
  const ownedFacts  = world.planets.filter(p => p.owner === empire.id && p.structures.factory > 0);
  const activeMines = ownedMines.filter(m => m.resources > 0);
  const ref         = factory ?? getPlanet(empire.homeMineId);
  const goal = pickGoal(rng, combineGoalWeights(baseGoalWeights(empire.personality, empire.doctrine), {
    expand: activeMines.length < 4 || activeMines.some(m => m.resources / Math.max(m.maxResources, 1) < 0.5) ? 1.55 : 0.95,
    pressure: ownShips.length > 6 ? 1.15 : 0.9,
    stabilize: factory && factory.stock < 20 ? 1.3 : ownShips.length < 5 ? 1.1 : 0.95,
  }));
  empire.goal = goal;

  const needsMine = goal === 'expand'
    ? activeMines.length < 4 || activeMines.some(m => m.resources / Math.max(m.maxResources, 1) < 0.5)
    : goal === 'pressure'
      ? activeMines.length < 3 || activeMines.some(m => m.resources / Math.max(m.maxResources, 1) < 0.38)
      : activeMines.length < 2 || activeMines.some(m => m.resources / Math.max(m.maxResources, 1) < 0.45);
  if (needsMine && ref) {
    const candidate = world.planets
      .filter(p => p.owner < 0 && p.resources > 0)
      .map(p => ({ p, dist: distance3d(ref, p) }))
      .filter(({ dist }) => dist <= (goal === 'expand' ? 300 : goal === 'pressure' ? 240 : 180))
      .sort((a, b) => {
        // 資源量も考慮してスコアリング（距離が近く資源が多い星を優先）
        const scoreA = a.p.resources / Math.max(a.p.maxResources, 1) - a.dist / (420 + empire.doctrine.logisticsBias * 360) + empire.doctrine.expansionBias * 0.2;
        const scoreB = b.p.resources / Math.max(b.p.maxResources, 1) - b.dist / (420 + empire.doctrine.logisticsBias * 360) + empire.doctrine.expansionBias * 0.2;
        return scoreB - scoreA;
      })[0]?.p;
    if (candidate) queueConstruction(empire, candidate, 'mine');
  }

  const mineStock = ownedMines.reduce((sum, m) => sum + m.stock, 0);
  const factoryCap = goal === 'expand'
    ? mineStock > 400 && ownShips.length > 12 ? 3 : 2
    : goal === 'pressure'
      ? mineStock > 320 && ownShips.length > 8 ? 2 : 1
      : mineStock > 200 && ownShips.length > 7 ? 2 : 1;
  const factoryThreshold = goal === 'expand' ? 150 : goal === 'pressure' ? 240 : 180;
  if (ownedFacts.length < factoryCap && mineStock > factoryThreshold && ownShips.length > (goal === 'expand' ? 5 : 7) && ref) {
    const candidate = world.planets
      .filter(p => p.owner < 0)
      .map(p => ({ p, dist: distance3d(ref, p) }))
      .filter(({ dist }) => dist <= (goal === 'expand' ? 260 : 200))
      .sort((a, b) => a.dist - b.dist)[0]?.p;
    if (candidate) queueConstruction(empire, candidate, 'factory');
  }

  if (factory && factory.stock < 20) {
    empire.intent = `${goalLabel(goal)}: reinforcing supply lines`;
  } else if (goal === 'expand') {
    empire.intent = needsMine ? 'claiming frontier ore deposits' : 'expanding fleet for logistics';
  } else if (goal === 'pressure') {
    empire.intent = ownShips.length < 5 ? 'arming pressure wing' : 'pushing outer logistics lines';
  } else if (ownShips.length < 5) {
    empire.intent = 'building frontier escort';
  } else {
    empire.intent = empire.summary;
  }
};
