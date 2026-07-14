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
    expand: activeMines.length < 3 || activeMines.some(m => m.resources / Math.max(m.maxResources, 1) < 0.6) ? 1.45 : 0.9,
    pressure: ownShips.length > 8 && factory?.stock > 80 ? 1.15 : 0.85,
    stabilize: factory && factory.stock < 25 ? 1.7 : ownShips.length < 6 ? 1.2 : 1.0,
  }));
  empire.goal = goal;

  const needsMine = goal === 'expand'
    ? activeMines.length < 3 || activeMines.some(m => m.resources / Math.max(m.maxResources, 1) < 0.6)
    : goal === 'pressure'
      ? activeMines.length < 2 || activeMines.some(m => m.resources / Math.max(m.maxResources, 1) < 0.45)
      : activeMines.length < 2 || activeMines.some(m => m.resources / Math.max(m.maxResources, 1) < 0.5);
  if (needsMine && ref) {
    const candidate = world.planets
      .filter(p => p.owner < 0 && p.resources > 0)
      .map(p => ({ p, dist: distance3d(ref, p) }))
      .filter(({ dist }) => dist <= (goal === 'pressure' ? 220 : goal === 'expand' ? 280 : 240))
      .sort((a, b) => a.dist - b.dist)[0]?.p;
    if (candidate) queueConstruction(empire, candidate, 'mine');
  }

  const mineStock = ownedMines.reduce((sum, m) => sum + m.stock, 0);
  const factoryTarget = goal === 'expand' ? 2 : goal === 'pressure' ? 1 : 2;
  const factoryThreshold = goal === 'expand' ? 200 : goal === 'pressure' ? 260 : 180;
  const factoryShips = goal === 'expand' ? 6 : goal === 'pressure' ? 8 : 7;
  if (ownedFacts.length < factoryTarget && mineStock > factoryThreshold && ownShips.length > factoryShips && ref) {
    const candidate = world.planets
      .filter(p => p.owner < 0)
      .map(p => ({ p, dist: distance3d(ref, p) }))
      .filter(({ dist }) => dist <= (goal === 'pressure' ? 180 : 220))
      .sort((a, b) => a.dist - b.dist)[0]?.p;
    if (candidate) queueConstruction(empire, candidate, 'factory');
  }

  if (factory && factory.stock < 25) {
    empire.intent = `${goalLabel(goal)}: rescue a hungry factory core`;
  } else if (goal === 'pressure') {
    empire.intent = ownShips.length < 7
      ? 'pressure enemy lines while arming attack wing'
      : 'pressuring enemy lines with supply-backed raiding';
  } else if (goal === 'expand') {
    empire.intent = needsMine ? 'scouting new ore deposits' : 'expanding industrial reach';
  } else if (ownShips.length < 6) {
    empire.intent = 'scaling transport capacity';
  } else {
    empire.intent = empire.summary;
  }
};
