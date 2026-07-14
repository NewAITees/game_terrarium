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
    expand: activeMines.length < 2 || activeMines.every(m => m.resources / Math.max(m.maxResources, 1) < 0.2) ? 1.05 : 0.85,
    pressure: ownShips.length > 8 ? 1.08 : 0.9,
    stabilize: factory && factory.stock < 30 ? 1.7 : ownShips.filter(s => s.kind === 'defender').length < 4 ? 1.35 : 1.0,
  }));
  empire.goal = goal;

  const needsMine = goal === 'stabilize'
    ? activeMines.length < 2 || activeMines.every(m => m.resources / Math.max(m.maxResources, 1) < 0.2)
    : goal === 'pressure'
      ? activeMines.length < 2 || activeMines.some(m => m.resources / Math.max(m.maxResources, 1) < 0.3)
      : activeMines.length < 3 || activeMines.some(m => m.resources / Math.max(m.maxResources, 1) < 0.45);
  if (needsMine && ref) {
    const candidate = world.planets
      .filter(p => p.owner < 0 && p.resources > 0)
      .map(p => ({ p, dist: distance3d(ref, p) }))
      .filter(({ dist }) => dist <= (goal === 'stabilize' ? 150 : goal === 'pressure' ? 180 : 220))
      .sort((a, b) => a.dist - b.dist)[0]?.p;
    if (candidate) queueConstruction(empire, candidate, 'mine');
  }

  const mineStock = ownedMines.reduce((sum, m) => sum + m.stock, 0);
  const factoryTarget = goal === 'stabilize' ? 2 : goal === 'pressure' ? 1 : 2;
  const factoryThreshold = goal === 'stabilize' ? 400 : goal === 'pressure' ? 280 : 220;
  const factoryShips = goal === 'stabilize' ? 10 : goal === 'pressure' ? 8 : 7;
  if (ownedFacts.length < factoryTarget && mineStock > factoryThreshold && ownShips.length > factoryShips && ref) {
    const candidate = world.planets
      .filter(p => p.owner < 0)
      .map(p => ({ p, dist: distance3d(ref, p) }))
      .filter(({ dist }) => dist <= (goal === 'stabilize' ? 150 : 180))
      .sort((a, b) => a.dist - b.dist)[0]?.p;
    if (candidate) queueConstruction(empire, candidate, 'factory');
  }

  if (factory && factory.stock < 30) {
    empire.intent = `${goalLabel(goal)}: shoring up factory reserves`;
  } else if (goal === 'stabilize') {
    if (needsMine) empire.intent = 'securing nearby ore supply';
    else if (ownShips.filter(s => s.kind === 'defender').length < 4) empire.intent = 'reinforcing planetary defenses';
    else empire.intent = 'holding supply network steady';
  } else if (goal === 'pressure') {
    empire.intent = ownShips.filter(s => s.kind === 'attacker').length < 3
      ? 'holding a pressure spearhead'
      : 'supporting a raid with defensive cover';
  } else {
    empire.intent = needsMine ? 'extending defensive ore ring' : empire.summary;
  }
};
