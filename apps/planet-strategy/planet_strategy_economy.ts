export function createPlanetStrategyEconomyRuntime(context: any) {
  const shipRatios = {
    industrialist: { transport: 0.60, attacker: 0.28, defender: 0.12 },
    raider: { transport: 0.28, attacker: 0.60, defender: 0.12 },
    expansionist: { transport: 0.38, attacker: 0.50, defender: 0.12 },
    fortifier: { transport: 0.38, attacker: 0.20, defender: 0.42 },
  };

  function runMining(step: number) {
    const falloffActive = context.world.oreFalloffStart !== null && context.world.time - context.world.oreFalloffStart < 20;
    for (const planet of context.world.planets) {
      if (planet.owner < 0 || planet.resources <= 0 || planet.structures.mine <= 0) continue;
      const rateScale = falloffActive ? 0.2 : 1;
      const mined = Math.min(planet.resources, planet.mineRate * (1 + planet.structures.mine * 0.5) * rateScale * step);
      planet.resources -= mined;
      planet.stock += mined;
      const empire = context.getEmpire(planet.owner);
      empire.mined += mined;
      context.world.minedTotal += mined;
      if (planet.resources <= 0) context.maybeLog(`depleted:${planet.id}`, `${planet.label} depleted its ore veins.`, 'warning', 1);
    }
  }

  function runCargoHandling(step: number) {
    for (const ship of context.world.ships) {
      const from = context.getPlanet(ship.fromPlanetId);
      const to = context.getPlanet(ship.toPlanetId);
      if (ship.status === 'loading') {
        const amount = Math.min(from.stock, ship.capacity - ship.cargo, 18 * step);
        ship.cargo += amount;
        from.stock -= amount;
        if (ship.cargo >= ship.capacity * 0.6 || from.stock <= 1) {
          ship.status = 'travel';
          ship.progress = 0;
          context.touchRoute(from.id, to.id, 3);
        }
      } else if (ship.status === 'unloading') {
        const amount = Math.min(ship.cargo, 18 * step);
        ship.cargo -= amount;
        if (to.underConstruction?.empireId === ship.owner) {
          to.underConstruction.progress += amount;
          if (to.underConstruction.progress >= to.underConstruction.needed) completeConstruction(to);
        } else {
          to.stock += amount;
          const empire = context.getEmpire(ship.owner);
          empire.delivered += amount;
          context.world.deliveredTotal += amount;
        }
        if (ship.cargo <= 0.01) {
          ship.cargo = 0;
          ship.status = 'travel_back';
          ship.progress = 0;
        }
      }
    }
  }

  function queueConstruction(empire: any, planet: any, type: any) {
    if (planet.underConstruction || planet.owner >= 0) return;
    planet.underConstruction = { empireId: empire.id, type, progress: 0, needed: 200 };
    context.maybeLog(`build:${empire.id}:${planet.id}`, `${empire.name} targets ${planet.label} for ${type} construction.`, 'empire', 5);
  }

  function completeConstruction(planet: any) {
    const { empireId, type } = planet.underConstruction;
    const empire = context.getEmpire(empireId);
    planet.owner = empireId;
    planet.type = type;
    if (type === 'mine') {
      planet.structures.mine = 1;
    } else {
      planet.structures.factory = 1;
      planet.factoryHp = 100;
    }
    planet.underConstruction = null;
    context.logEvent(`${empire?.name ?? '?'} completed ${type} on ${planet.label}!`, 'resource');
  }

  function updateEmpireIntentions() {
    const aiContext = {
      world: context.world,
      getPlanet: context.getPlanet,
      distance3d: context.distance3d,
      queueConstruction,
      maybeLog: context.maybeLog,
    };
    for (const empire of context.world.empires) {
      if (empire.collapsed) {
        empire.intent = 'collapsed and drifting out of contention';
        continue;
      }
      const strategy = context.aiStrategies[empire.personality];
      if (strategy) strategy(empire, aiContext);
    }
  }

  function assignRoutes() {
    for (const empire of context.world.empires) {
      if (empire.collapsed) continue;
      const mines = context.world.planets.filter((planet: any) => planet.owner === empire.id && planet.structures.mine > 0 && (planet.resources > 0 || planet.stock > 0));
      const factories = context.world.planets.filter((planet: any) => planet.owner === empire.id && planet.structures.factory > 0);
      const constructions = context.world.planets.filter((planet: any) => planet.underConstruction?.empireId === empire.id);
      if (!mines.length || !factories.length) continue;

      const idleShips = context.world.ships.filter((ship: any) => ship.owner === empire.id && (ship.status === 'loading' || ship.status === 'idle'));
      const factoryStock = factories.reduce((sum: number, factory: any) => sum + factory.stock, 0);
      const canBuild = constructions.length > 0 && factoryStock > 50;
      idleShips.forEach((ship: any, index: number) => {
        const bestMine = mines.sort((a: any, b: any) => (b.stock + b.resources * 0.05) - (a.stock + a.resources * 0.05))[0];
        const constructionTarget = canBuild && index % 5 === 0 ? constructions[0] : null;
        if (constructionTarget) {
          ship.fromPlanetId = bestMine.id;
          ship.toPlanetId = constructionTarget.id;
        } else {
          const bestFactory = factories.sort((a: any, b: any) => context.distance3d(bestMine, a) - context.distance3d(bestMine, b))[0];
          ship.fromPlanetId = bestMine.id;
          ship.toPlanetId = bestFactory.id;
        }
      });
    }
  }

  function chooseShipKind(empire: any) {
    const owned = context.world.ships.filter((ship: any) => ship.owner === empire.id);
    const total = owned.length + 1;
    const transportRatio = owned.filter((ship: any) => ship.kind === 'transport').length / total;
    const attackerRatio = owned.filter((ship: any) => ship.kind === 'attacker').length / total;
    const ratio = shipRatios[empire.personality] ?? shipRatios.industrialist;
    if (transportRatio < ratio.transport) return 'transport';
    if (attackerRatio < ratio.attacker) return 'attacker';
    return 'defender';
  }

  function runFactories(step: number) {
    for (const empire of context.world.empires) {
      if (empire.collapsed) continue;
      const ownShips = context.world.ships.filter((ship: any) => ship.owner === empire.id);
      const ownedFactories = context.world.planets.filter((planet: any) => planet.owner === empire.id && planet.structures.factory > 0);

      for (const factory of ownedFactories) {
        const isHome = factory.id === empire.homeFactoryId;
        if (factory.stock >= context.factoryMaintenanceCost) {
          factory.stock -= context.factoryMaintenanceCost;
          if (factory.stalled) context.maybeLog(`resume:${factory.id}`, `${factory.label} recovered from ore starvation.`, 'resource', 6);
          factory.stalled = false;
          if (isHome) empire.stalledTime = Math.max(0, empire.stalledTime - step * 0.5);
        } else {
          factory.stalled = true;
          if (isHome) empire.stalledTime += step;
          context.maybeLog(`starved:${factory.id}`, `${factory.label} factory stalling for ore.`, 'warning', 2);
          continue;
        }

        if (factory.stock >= context.shipBuildCost && ownShips.length < empire.shipCap) {
          factory.stock -= context.shipBuildCost;
          const kind = chooseShipKind(empire);
          const bestMine = context.world.planets
            .filter((planet: any) => planet.owner === empire.id && planet.structures.mine > 0 && (planet.resources > 0 || planet.stock > 0))
            .sort((a: any, b: any) => (b.stock + b.resources * 0.05) - (a.stock + a.resources * 0.05))[0];
          const ship = kind === 'transport'
            ? context.createTransportShip(empire, bestMine?.id ?? empire.homeMineId, factory.id, context.world.shipSerial++)
            : context.createCombatShip(empire, factory.id, kind, context.world.shipSerial++);
          context.rendererView.attachShipMesh(ship, empire);
          context.world.ships.push(ship);
          empire.producedShips += 1;
          context.maybeLog(`newShip:${empire.id}:${kind}`, `${empire.name} launched a ${kind}.`, 'empire', 2);
        }
      }
    }
  }

  function updateShips(dt: number) {
    for (const ship of context.world.ships) {
      if (ship.status !== 'travel' && ship.status !== 'travel_back') continue;
      ship.progress = Math.min(1, ship.progress + dt * ship.speed);
      if (ship.progress >= 1) {
        ship.status = ship.status === 'travel' ? 'unloading' : 'loading';
        ship.progress = 0;
      }
    }
  }

  function updateOrbiting(dt: number) {
    for (const ship of context.world.ships) {
      if (ship.status !== 'orbiting' && ship.status !== 'battling') continue;
      ship.orbitAngle += dt * ship.orbitSpeed;
      const planetId = ship.status === 'battling' ? ship.targetPlanetId : ship.homePlanetId;
      const planet = context.getPlanet(planetId ?? ship.fromPlanetId);
      if (!planet || !ship.mesh) continue;
      const planetSize = 5 + (planet.resources / Math.max(planet.maxResources, 1)) * 8;
      const radius = ship.orbitRadius + planetSize * 0.6;
      ship.mesh.position.set(
        planet.x + Math.cos(ship.orbitAngle) * radius,
        planet.y + 2 + ship.owner * 1.8,
        planet.z + Math.sin(ship.orbitAngle) * radius
      );
      if (ship.kind !== 'defender') {
        ship.mesh.rotation.y = ship.orbitAngle + Math.PI / 2;
      } else {
        ship.mesh.rotation.y += dt * 1.2;
      }
      const hpFrac = ship.hp / ship.maxHp;
      const intensity = ship.status === 'battling'
        ? 0.6 + Math.sin(performance.now() / 180) * 0.4
        : 0.25 + (1 - hpFrac) * 0.3;
      ship.mesh.traverse((node: any) => {
        if (node.material && !Array.isArray(node.material)) node.material.emissiveIntensity = intensity;
      });
      ship.mesh.scale.setScalar(0.9 + hpFrac * 0.4);
    }
  }

  function decayTraffic(dt: number) {
    for (const route of context.world.routes.values()) {
      route.traffic = Math.max(0, route.traffic - dt * 0.5);
    }
  }

  return {
    assignRoutes,
    completeConstruction,
    decayTraffic,
    queueConstruction,
    runCargoHandling,
    runFactories,
    runMining,
    updateEmpireIntentions,
    updateOrbiting,
    updateShips,
  };
}
