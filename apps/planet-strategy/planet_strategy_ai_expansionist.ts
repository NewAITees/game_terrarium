import type { PlanetStrategyAiStrategy } from '../../shared/types/planet_strategy.js';

export const updateStrategy: PlanetStrategyAiStrategy = (empire, ctx) => {
  const { world, getPlanet, distance3d, queueConstruction } = ctx;
  const factory     = getPlanet(empire.homeFactoryId);
  const ownShips    = world.ships.filter(s => s.owner === empire.id);
  const ownedMines  = world.planets.filter(p => p.owner === empire.id && p.structures.mine > 0);
  const ownedFacts  = world.planets.filter(p => p.owner === empire.id && p.structures.factory > 0);
  const activeMines = ownedMines.filter(m => m.resources > 0);
  const ref         = factory ?? getPlanet(empire.homeMineId);

  // 領土最大化: 残資源50%以下で展開・最大4鉱山・広域カバー
  const needsMine = activeMines.length < 4 ||
    activeMines.some(m => m.resources / Math.max(m.maxResources, 1) < 0.5);
  if (needsMine && ref) {
    const candidate = world.planets
      .filter(p => p.owner < 0 && p.resources > 0)
      .map(p => ({ p, dist: distance3d(ref, p) }))
      .filter(({ dist }) => dist <= 300)
      .sort((a, b) => {
        // 資源量も考慮してスコアリング（距離が近く資源が多い星を優先）
        const scoreA = a.p.resources / Math.max(a.p.maxResources, 1) - a.dist / 600;
        const scoreB = b.p.resources / Math.max(b.p.maxResources, 1) - b.dist / 600;
        return scoreB - scoreA;
      })[0]?.p;
    if (candidate) queueConstruction(empire, candidate, 'mine');
  }

  // 積極的工場展開: 在庫150+・船5+で第2工場、在庫400+・船12+で第3工場
  const mineStock = ownedMines.reduce((sum, m) => sum + m.stock, 0);
  const factoryCap = mineStock > 400 && ownShips.length > 12 ? 3 : 2;
  if (ownedFacts.length < factoryCap && mineStock > 150 && ownShips.length > 5 && ref) {
    const candidate = world.planets
      .filter(p => p.owner < 0)
      .map(p => ({ p, dist: distance3d(ref, p) }))
      .filter(({ dist }) => dist <= 260)
      .sort((a, b) => a.dist - b.dist)[0]?.p;
    if (candidate) queueConstruction(empire, candidate, 'factory');
  }

  if (factory && factory.stock < 20) {
    empire.intent = 'reinforcing supply lines';
  } else if (needsMine) {
    empire.intent = 'claiming frontier ore deposits';
  } else if (ownShips.length < 5) {
    empire.intent = 'expanding fleet for logistics';
  } else {
    empire.intent = empire.summary;
  }
};
