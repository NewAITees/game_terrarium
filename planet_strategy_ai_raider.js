export function updateStrategy(empire, ctx) {
  const { world, getPlanet, distance3d, queueConstruction } = ctx;
  const factory     = getPlanet(empire.homeFactoryId);
  const ownShips    = world.ships.filter(s => s.owner === empire.id);
  const ownedMines  = world.planets.filter(p => p.owner === empire.id && p.structures.mine > 0);
  const activeMines = ownedMines.filter(m => m.resources > 0);
  const ref         = factory ?? getPlanet(empire.homeMineId);

  // 最小限の鉱山展開: 残資源30%以下・近距離のみ・最大2鉱山
  // 拡張は戦闘による占領を優先するため閾値を低く設定
  const needsMine = activeMines.length < 2 ||
    activeMines.some(m => m.resources / Math.max(m.maxResources, 1) < 0.3);
  if (needsMine && ref) {
    const candidate = world.planets
      .filter(p => p.owner < 0 && p.resources > 0)
      .map(p => ({ p, dist: distance3d(ref, p) }))
      .filter(({ dist }) => dist <= 180)
      .sort((a, b) => a.dist - b.dist)[0]?.p;
    if (candidate) queueConstruction(empire, candidate, 'mine');
  }

  // 工場は展開しない（戦闘で奪った惑星を活用）

  if (factory && factory.stock < 20) {
    empire.intent = 'emergency ore resupply';
  } else if (needsMine) {
    empire.intent = 'raiding for new ore veins';
  } else if (ownShips.filter(s => s.kind === 'attacker').length < 3) {
    empire.intent = 'arming attack wing';
  } else {
    empire.intent = empire.summary;
  }
}
