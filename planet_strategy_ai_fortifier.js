export function updateStrategy(empire, ctx) {
  const { world, getPlanet, distance3d, queueConstruction } = ctx;
  const factory     = getPlanet(empire.homeFactoryId);
  const ownShips    = world.ships.filter(s => s.owner === empire.id);
  const ownedMines  = world.planets.filter(p => p.owner === empire.id && p.structures.mine > 0);
  const ownedFacts  = world.planets.filter(p => p.owner === empire.id && p.structures.factory > 0);
  const activeMines = ownedMines.filter(m => m.resources > 0);
  const ref         = factory ?? getPlanet(empire.homeMineId);

  // 慎重な鉱山展開: 残資源20%以下・近距離のみ・最大2鉱山
  const needsMine = activeMines.length < 2 ||
    activeMines.every(m => m.resources / Math.max(m.maxResources, 1) < 0.2);
  if (needsMine && ref) {
    const candidate = world.planets
      .filter(p => p.owner < 0 && p.resources > 0)
      .map(p => ({ p, dist: distance3d(ref, p) }))
      .filter(({ dist }) => dist <= 150)
      .sort((a, b) => a.dist - b.dist)[0]?.p;
    if (candidate) queueConstruction(empire, candidate, 'mine');
  }

  // 工場展開: 非常に安定した状態でのみ（在庫400+・船10+）
  const mineStock = ownedMines.reduce((sum, m) => sum + m.stock, 0);
  if (ownedFacts.length < 2 && mineStock > 400 && ownShips.length > 10 && ref) {
    const candidate = world.planets
      .filter(p => p.owner < 0)
      .map(p => ({ p, dist: distance3d(ref, p) }))
      .filter(({ dist }) => dist <= 150)
      .sort((a, b) => a.dist - b.dist)[0]?.p;
    if (candidate) queueConstruction(empire, candidate, 'factory');
  }

  if (factory && factory.stock < 30) {
    empire.intent = 'shoring up factory reserves';
  } else if (needsMine) {
    empire.intent = 'securing nearby ore supply';
  } else if (ownShips.filter(s => s.kind === 'defender').length < 4) {
    empire.intent = 'reinforcing planetary defenses';
  } else {
    empire.intent = empire.summary;
  }
}
