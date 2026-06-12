import type { PlanetStrategyAiStrategy } from '../../shared/types/planet_strategy.js';
import { baseGoalWeights, combineGoalWeights, goalLabel, pickGoal } from './planet_strategy_ai_goals.js';

export const updateStrategy: PlanetStrategyAiStrategy = (empire, ctx) => {
  const { world, getPlanet, distance3d, queueConstruction, rng } = ctx;
  const factory     = getPlanet(empire.homeFactoryId);
  const ownShips    = world.ships.filter(s => s.owner === empire.id);
  const ownedMines  = world.planets.filter(p => p.owner === empire.id && p.structures.mine > 0);
  const activeMines = ownedMines.filter(m => m.resources > 0);
  const ref         = factory ?? getPlanet(empire.homeMineId);
  const goal = pickGoal(rng, combineGoalWeights(baseGoalWeights(empire.personality), {
    expand: activeMines.length < 2 || activeMines.some(m => m.resources / Math.max(m.maxResources, 1) < 0.35) ? 1.1 : 0.8,
    pressure: ownShips.length > 4 ? 1.5 : 1.05,
    stabilize: factory && factory.stock < 20 ? 1.8 : ownShips.length < 5 ? 1.2 : 0.9,
  }));
  empire.goal = goal;

  const needsMine = goal === 'pressure'
    ? activeMines.length < 2 || activeMines.some(m => m.resources / Math.max(m.maxResources, 1) < 0.3)
    : goal === 'expand'
      ? activeMines.length < 3 || activeMines.some(m => m.resources / Math.max(m.maxResources, 1) < 0.4)
      : activeMines.length < 2 || activeMines.some(m => m.resources / Math.max(m.maxResources, 1) < 0.25);
  if (needsMine && ref) {
    const candidate = world.planets
      .filter(p => p.owner < 0 && p.resources > 0)
      .map(p => ({ p, dist: distance3d(ref, p) }))
      .filter(({ dist }) => dist <= (goal === 'pressure' ? 160 : goal === 'expand' ? 220 : 140))
      .sort((a, b) => a.dist - b.dist)[0]?.p;
    if (candidate) queueConstruction(empire, candidate, 'mine');
  }

  if (goal === 'expand' && factory && factory.stock > 180 && ownShips.length > 5 && ref) {
    const candidate = world.planets
      .filter(p => p.owner < 0)
      .map(p => ({ p, dist: distance3d(ref, p) }))
      .filter(({ dist }) => dist <= 200)
      .sort((a, b) => a.dist - b.dist)[0]?.p;
    if (candidate) queueConstruction(empire, candidate, 'factory');
  }

  if (factory && factory.stock < 20) {
    empire.intent = `${goalLabel(goal)}: emergency ore resupply`;
  } else if (goal === 'pressure') {
    empire.intent = ownShips.filter(s => s.kind === 'attacker').length < 3
      ? 'arming attack wing'
      : 'raiding for enemy weak points';
  } else if (goal === 'expand') {
    empire.intent = needsMine ? 'raiding for new ore veins' : 'stretching frontier supply';
  } else if (ownShips.filter(s => s.kind === 'defender').length < 3) {
    empire.intent = 'holding raided ground';
  } else {
    empire.intent = empire.summary;
  }
};
