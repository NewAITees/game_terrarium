export function updateStrategy(empire, ctx) {
  const { world, getPlanet, distance3d, queueConstruction } = ctx;
  const factory     = getPlanet(empire.homeFactoryId);
  const ownShips    = world.ships.filter(s => s.owner === empire.id);
  const ownedMines  = world.planets.filter(p => p.owner === empire.id && p.structures.mine > 0);
  const ownedFacts  = world.planets.filter(p => p.owner === empire.id && p.structures.factory > 0);
  const activeMines = ownedMines.filter(m => m.resources > 0);
  const ref         = factory ?? getPlanet(empire.homeMineId);

  // 積極的鉱山展開: 残資源60%以下 or 稼働鉱山3未満で先手
  const needsMine = activeMines.length < 3 ||
    activeMines.some(m => m.resources / Math.max(m.maxResources, 1) < 0.6);
  if (needsMine && ref) {
    const candidate = world.planets
      .filter(p => p.owner < 0 && p.resources > 0)
      .map(p => ({ p, dist: distance3d(ref, p) }))
      .filter(({ dist }) => dist <= 280)
      .sort((a, b) => a.dist - b.dist)[0]?.p;
    if (candidate) queueConstruction(empire, candidate, 'mine');
  }

  // 工場展開: 在庫200+・船6+で第2工場
  const mineStock = ownedMines.reduce((sum, m) => sum + m.stock, 0);
  if (ownedFacts.length < 2 && mineStock > 200 && ownShips.length > 6 && ref) {
    const candidate = world.planets
      .filter(p => p.owner < 0)
      .map(p => ({ p, dist: distance3d(ref, p) }))
      .filter(({ dist }) => dist <= 220)
      .sort((a, b) => a.dist - b.dist)[0]?.p;
    if (candidate) queueConstruction(empire, candidate, 'factory');
  }

  if (factory && factory.stock < 25) {
    empire.intent = 'rescue a hungry factory core';
  } else if (needsMine) {
    empire.intent = 'scouting new ore deposits';
  } else if (ownShips.length < 6) {
    empire.intent = 'scaling transport capacity';
  } else {
    empire.intent = empire.summary;
  }
}
