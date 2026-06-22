import { stepPlanetStrategyShips } from './planet_strategy_wasm_bridge.js';

export function createPlanetStrategyEconomyRuntime(context: any) {
  const shipRatios = {
    industrialist: { transport: 0.56, attacker: 0.24, gunship: 0.06, defender: 0.14 },
    raider: { transport: 0.26, attacker: 0.42, gunship: 0.16, defender: 0.16 },
    expansionist: { transport: 0.34, attacker: 0.38, gunship: 0.12, defender: 0.16 },
    fortifier: { transport: 0.32, attacker: 0.16, gunship: 0.06, defender: 0.46 },
  };
  const shipJumpCooldowns = new Map<string, number>();

  function getPlanetOrFallback(planetId: string | null | undefined) {
    return planetId ? context.getPlanet(planetId) : undefined;
  }

  function getOrbitRadius(planet: any, ship: any) {
    const base = planet?.type === 'factory' ? 8.7 : 6.8;
    if (ship.kind === 'transport') return base + 2.4;
    if (ship.kind === 'gunship') return base + 1.8;
    return base + 1.2;
  }

  function getOrbitAnchor(planet: any, ship: any) {
    if (!planet) return { x: 0, y: 0, z: 0 };
    const radius = getOrbitRadius(planet, ship);
    const angle = ship.orbitAngle ?? 0;
    const yBias = planet.type === 'factory' ? 2.8 : 1.5;
    return {
      x: planet.x + Math.cos(angle) * radius,
      y: planet.y + yBias,
      z: planet.z + Math.sin(angle) * radius,
    };
  }

  function getDockPoint(planet: any, ship: any) {
    if (!planet) return { x: 0, y: 0, z: 0 };
    const anchor = getOrbitAnchor(planet, ship);
    return {
      x: anchor.x,
      y: anchor.y - 1.2,
      z: anchor.z,
    };
  }

  function setShipPosition(ship: any, position: any) {
    const previous = ship.position ? { ...ship.position } : null;
    ship.position = { x: position.x, y: position.y, z: position.z };
    ship.x = position.x;
    ship.y = position.y;
    ship.z = position.z;
    if (ship.mesh) ship.mesh.position.set(position.x, position.y, position.z);
    recordShipJump(ship, previous, ship.position, 'js-update');
  }

  function recordShipJump(ship: any, previous: any, next: any, note: string) {
    if (!previous || !next) return;
    const delta = Math.hypot((next.x ?? 0) - (previous.x ?? 0), (next.y ?? 0) - (previous.y ?? 0), (next.z ?? 0) - (previous.z ?? 0));
    const status = String(ship.status ?? '');
    if (delta < 6) return;

    const last = shipJumpCooldowns.get(ship.id) ?? -Infinity;
    if (context.world.time - last < 1.5) return;
    shipJumpCooldowns.set(ship.id, context.world.time);

    const line = [
      new Date().toISOString(),
      `ship=${ship.id}`,
      `kind=${ship.kind}`,
      `status=${status}`,
      `from=${ship.fromPlanetId}`,
      `to=${ship.toPlanetId}`,
      `prev=(${(previous.x ?? 0).toFixed(2)},${(previous.y ?? 0).toFixed(2)},${(previous.z ?? 0).toFixed(2)})`,
      `now=(${(next.x ?? 0).toFixed(2)},${(next.y ?? 0).toFixed(2)},${(next.z ?? 0).toFixed(2)})`,
      `delta=${delta.toFixed(2)}`,
      `note=${note}`,
    ].join(' ');
    context.recordShipJump?.(line);
  }

  function setShipFacing(ship: any, from: any, to: any) {
    if (!ship.mesh || !from || !to) return;
    ship.mesh.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
  }

  function updateShipOrbit(ship: any, planet: any, dt: number) {
    if (!planet) return;
    ship.orbitAngle += dt * ship.orbitSpeed;
    const anchor = getOrbitAnchor(planet, ship);
    setShipPosition(ship, anchor);
    if (ship.kind !== 'defender') {
      ship.mesh.rotation.y = ship.orbitAngle + Math.PI / 2;
    } else {
      ship.mesh.rotation.y += dt * 1.2;
    }
    const hpFrac = ship.hp / Math.max(ship.maxHp, 1);
    const intensity = ship.status === 'engaging'
      ? 0.7 + Math.sin(performance.now() / 180) * 0.3
      : 0.22 + (1 - hpFrac) * 0.28;
    ship.mesh?.traverse((node: any) => {
      if (node.material && !Array.isArray(node.material) && 'emissiveIntensity' in node.material) {
        node.material.emissiveIntensity = intensity;
      }
    });
    ship.mesh?.scale.setScalar(0.92 + hpFrac * 0.38);
  }

  function beginLaunch(ship: any) {
    ship.status = 'launching';
    ship.progress = 0;
    ship.launchTimer = 0.75;
  }

  function beginTravel(ship: any) {
    ship.status = 'traveling';
    ship.progress = 0;
  }

  function beginApproach(ship: any) {
    ship.status = 'approaching';
    ship.progress = 0;
  }

  function finishArrival(ship: any) {
    ship.homePlanetId = ship.toPlanetId;
    ship.progress = 0;
    if (ship.kind === 'transport') {
      ship.status = 'docked';
    } else {
      ship.status = 'engaging';
      ship.fireCooldown = 0.2;
    }
  }

  function reverseTransportRoute(ship: any) {
    const nextTo = ship.fromPlanetId;
    ship.fromPlanetId = ship.toPlanetId;
    ship.toPlanetId = nextTo;
    ship.homePlanetId = ship.fromPlanetId;
  }

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
      if (ship.kind !== 'transport') continue;
      const currentPlanet = getPlanetOrFallback(ship.homePlanetId) ?? getPlanetOrFallback(ship.fromPlanetId);
      if (ship.status !== 'docked' || !currentPlanet) continue;

      const loadingLeg = ship.homePlanetId === ship.fromPlanetId;
      if (loadingLeg) {
        const amount = Math.min(currentPlanet.stock, ship.capacity - ship.cargo, 18 * step);
        ship.cargo += amount;
        currentPlanet.stock -= amount;
        if (ship.cargo >= ship.capacity * 0.6 || currentPlanet.stock <= 1) {
          beginLaunch(ship);
          context.touchRoute(ship.fromPlanetId, ship.toPlanetId, 3);
        }
      } else {
        const amount = Math.min(ship.cargo, 18 * step);
        ship.cargo -= amount;
        if (currentPlanet.underConstruction?.empireId === ship.owner) {
          currentPlanet.underConstruction.progress += amount;
          if (currentPlanet.underConstruction.progress >= currentPlanet.underConstruction.needed) completeConstruction(currentPlanet);
        } else {
          currentPlanet.stock += amount;
          const empire = context.getEmpire(ship.owner);
          empire.delivered += amount;
          context.world.deliveredTotal += amount;
        }
        if (ship.cargo <= 0.01) {
          ship.cargo = 0;
          reverseTransportRoute(ship);
          beginLaunch(ship);
        }
      }
      setShipPosition(ship, getDockPoint(currentPlanet, ship));
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
      planet.structures.turret = Math.max(planet.structures.turret, 1);
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
      rng: context.rng,
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

      const dockedShips = context.world.ships.filter((ship: any) => ship.owner === empire.id && ship.kind === 'transport' && ship.status === 'docked' && ship.cargo === 0);
      const factoryStock = factories.reduce((sum: number, factory: any) => sum + factory.stock, 0);
      const canBuild = constructions.length > 0 && factoryStock > 50;

      for (const ship of dockedShips) {
        const bestMine = [...mines].sort((a: any, b: any) => (b.stock + b.resources * 0.05) - (a.stock + a.resources * 0.05))[0];
        const constructionTarget = canBuild ? constructions[0] : null;
        if (!bestMine) continue;
        if (constructionTarget) {
          ship.fromPlanetId = bestMine.id;
          ship.toPlanetId = constructionTarget.id;
        } else {
          const bestFactory = [...factories].sort((a: any, b: any) => context.distance3d(bestMine, a) - context.distance3d(bestMine, b))[0];
          ship.fromPlanetId = bestMine.id;
          ship.toPlanetId = bestFactory.id;
        }
        if (ship.homePlanetId !== ship.fromPlanetId) {
          ship.homePlanetId = ship.fromPlanetId;
          setShipPosition(ship, getDockPoint(bestMine, ship));
        }
      }
    }
  }

  function chooseShipKind(empire: any) {
    const owned = context.world.ships.filter((ship: any) => ship.owner === empire.id);
    const total = owned.length + 1;
    const transportRatio = owned.filter((ship: any) => ship.kind === 'transport').length / total;
    const attackerRatio = owned.filter((ship: any) => ship.kind === 'attacker').length / total;
    const gunshipRatio = owned.filter((ship: any) => ship.kind === 'gunship').length / total;
    const ratio = shipRatios[empire.personality] ?? shipRatios.industrialist;
    const goalBias = empire.goal === 'pressure'
      ? { transport: 0.78, attacker: 1.35, gunship: 1.18, defender: 0.88 }
      : empire.goal === 'expand'
        ? { transport: 1.25, attacker: 0.92, gunship: 0.82, defender: 0.92 }
        : { transport: 1.02, attacker: 0.9, gunship: 0.84, defender: 1.18 };
    const weighted = {
      transport: ratio.transport * goalBias.transport,
      attacker: ratio.attacker * goalBias.attacker,
      gunship: ratio.gunship * goalBias.gunship,
      defender: ratio.defender * goalBias.defender,
    };
    if (transportRatio < weighted.transport) return 'transport';
    if (gunshipRatio < weighted.gunship) return 'gunship';
    if (attackerRatio < weighted.attacker) return 'attacker';
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
          setShipPosition(ship, getDockPoint(factory, ship));
        }
      }
    }
  }

  function stepShipsViaWasm(dt: number) {
    const payload = {
      dt,
      planets: context.world.planets.map((planet: any) => ({
        id: planet.id,
        x: planet.x,
        y: planet.y,
        z: planet.z,
        type: planet.type,
      })),
      ships: context.world.ships.map((ship: any) => ({
        id: ship.id,
        kind: ship.kind,
        status: ship.status,
        from_planet_id: ship.fromPlanetId,
        to_planet_id: ship.toPlanetId,
        home_planet_id: ship.homePlanetId,
        target_planet_id: ship.targetPlanetId,
        x: ship.position?.x ?? ship.x ?? 0,
        y: ship.position?.y ?? ship.y ?? 0,
        z: ship.position?.z ?? ship.z ?? 0,
        progress: ship.progress ?? 0,
        speed: ship.speed ?? 0,
        cargo: ship.cargo ?? 0,
        capacity: ship.capacity ?? 0,
        hp: ship.hp ?? 0,
        max_hp: ship.maxHp ?? 0,
        phys_attack: ship.physAttack ?? ship.attack ?? 0,
        laser_attack: ship.laserAttack ?? 0,
        phys_def: ship.physDef ?? 0,
        heat_def: ship.heatDef ?? 0,
        attack: ship.attack ?? 0,
        defense: ship.defense ?? 0,
        orbit_angle: ship.orbitAngle ?? 0,
        orbit_radius: ship.orbitRadius ?? 0,
        orbit_speed: ship.orbitSpeed ?? 0,
        launch_timer: ship.launchTimer ?? 0,
        fire_cooldown: ship.fireCooldown ?? 0,
      })),
    };
    let result: { ships: Array<{
      id: string;
      x: number;
      y: number;
      z: number;
      status: string;
      progress: number;
      launch_timer: number;
      orbit_angle: number;
      home_planet_id: string;
      from_planet_id: string;
      to_planet_id: string;
      target_planet_id: string | null;
      fire_cooldown: number;
    }> } | null = null;
    try {
      result = stepPlanetStrategyShips(payload);
    } catch {
      return false;
    }
    if (!result?.ships?.length) return false;

    const prevState = new Map<string, {
      status: string;
      kind: string;
      fromPlanetId: string;
      toPlanetId: string;
    }>(context.world.ships.map((ship: any) => [ship.id, {
      status: ship.status,
      kind: ship.kind,
      fromPlanetId: ship.fromPlanetId,
      toPlanetId: ship.toPlanetId,
    }]));
    const shipById = new Map<string, any>(context.world.ships.map((ship: any) => [ship.id, ship]));

    const shipOutputs = result.ships as Array<{
      id: string;
      x: number;
      y: number;
      z: number;
      status: string;
      progress: number;
      launch_timer: number;
      orbit_angle: number;
      home_planet_id: string;
      from_planet_id: string;
      to_planet_id: string;
      target_planet_id: string | null;
      fire_cooldown: number;
    }>;

    for (const output of shipOutputs) {
      const ship = shipById.get(output.id);
      if (!ship) continue;
      const prev = prevState.get(output.id);
      const previousPosition = ship.position ? { ...ship.position } : { x: ship.x ?? 0, y: ship.y ?? 0, z: ship.z ?? 0 };
      ship.position = { x: output.x, y: output.y, z: output.z };
      ship.x = output.x;
      ship.y = output.y;
      ship.z = output.z;
      ship.status = output.status;
      ship.progress = output.progress;
      ship.launchTimer = output.launch_timer;
      ship.orbitAngle = output.orbit_angle;
      ship.homePlanetId = output.home_planet_id;
      ship.fromPlanetId = output.from_planet_id;
      ship.toPlanetId = output.to_planet_id;
      ship.targetPlanetId = output.target_planet_id;
      ship.fireCooldown = output.fire_cooldown;
      if (ship.mesh) ship.mesh.position.set(ship.position.x, ship.position.y, ship.position.z);
      recordShipJump(ship, previousPosition, ship.position, 'wasm-update');

      if (prev?.status !== output.status && output.status === 'traveling') {
        context.touchRoute(output.from_planet_id, output.to_planet_id, ship.kind === 'transport' ? 2 : 6);
      }
    }

    return true;
  }

  function updateShips(dt: number) {
    if (stepShipsViaWasm(dt)) return;

    for (const ship of context.world.ships) {
      ship.launchTimer = Math.max(0, (ship.launchTimer ?? 0) - dt);
      const from = getPlanetOrFallback(ship.fromPlanetId);
      const to = getPlanetOrFallback(ship.toPlanetId);
      const current = getPlanetOrFallback(ship.homePlanetId);

      if (ship.status === 'docked') {
        const dockPlanet = current ?? from ?? to;
        if (dockPlanet) setShipPosition(ship, getDockPoint(dockPlanet, ship));

        if (ship.kind === 'transport') {
          continue;
        }

        if (ship.targetPlanetId && ship.homePlanetId === ship.fromPlanetId && ship.launchTimer <= 0) {
          beginLaunch(ship);
        }
        continue;
      }

      if (ship.status === 'launching') {
        ship.progress = Math.min(1, ship.progress + dt * 1.4);
        const origin = current ?? from;
        const originPoint = origin ? getDockPoint(origin, ship) : { x: ship.position.x, y: ship.position.y, z: ship.position.z };
        const orbitPoint = origin ? getOrbitAnchor(origin, ship) : originPoint;
        const eased = ship.progress * ship.progress;
        setShipPosition(ship, {
          x: originPoint.x + (orbitPoint.x - originPoint.x) * eased,
          y: originPoint.y + (orbitPoint.y - originPoint.y) * eased,
          z: originPoint.z + (orbitPoint.z - originPoint.z) * eased,
        });
        if (ship.progress >= 1) {
          ship.status = 'orbiting';
          ship.progress = 0;
          ship.launchTimer = 0.45;
        }
        continue;
      }

      if (ship.status === 'orbiting') {
        const orbitPlanet = ship.kind === 'transport'
          ? getPlanetOrFallback(ship.homePlanetId)
          : getPlanetOrFallback(ship.homePlanetId);
        if (orbitPlanet) updateShipOrbit(ship, orbitPlanet, dt);
        else if (ship.mesh) setShipPosition(ship, ship.mesh.position);

        ship.progress += dt;
        if (ship.kind === 'transport' && ship.homePlanetId === ship.fromPlanetId && ship.cargo > 0 && ship.progress >= 0.35) {
          beginTravel(ship);
          context.touchRoute(ship.fromPlanetId, ship.toPlanetId, 2);
          continue;
        }
        if (ship.kind !== 'transport' && ship.targetPlanetId && ship.homePlanetId === ship.fromPlanetId && ship.progress >= 0.6) {
          beginTravel(ship);
          context.touchRoute(ship.fromPlanetId, ship.toPlanetId, 6);
        }
        continue;
      }

      if (ship.status === 'traveling' || ship.status === 'approaching') {
        const origin = getPlanetOrFallback(ship.fromPlanetId);
        const target = getPlanetOrFallback(ship.toPlanetId);
        const originPoint = origin ? getOrbitAnchor(origin, ship) : { x: ship.position.x, y: ship.position.y, z: ship.position.z };
        const targetPoint = target ? getOrbitAnchor(target, ship) : originPoint;
        const approachStart = 0.82;
        const travelRate = dt * ship.speed * 1.75;
        ship.progress = Math.min(1, ship.progress + travelRate);
        const t = ship.status === 'traveling'
          ? Math.min(1, ship.progress / approachStart)
          : approachStart + (1 - approachStart) * ship.progress;
        setShipPosition(ship, {
          x: originPoint.x + (targetPoint.x - originPoint.x) * t,
          y: originPoint.y + (targetPoint.y - originPoint.y) * t,
          z: originPoint.z + (targetPoint.z - originPoint.z) * t,
        });
        setShipFacing(ship, originPoint, targetPoint);
        if (ship.progress >= 1) {
          finishArrival(ship);
          if (ship.kind === 'transport' && ship.homePlanetId === ship.toPlanetId) {
            ship.launchTimer = 0;
          }
        } else if (ship.status === 'traveling' && ship.progress >= approachStart) {
          beginApproach(ship);
        }
        continue;
      }

      if (ship.status === 'engaging') {
        const targetPlanet = getPlanetOrFallback(ship.targetPlanetId ?? ship.homePlanetId);
        if (!targetPlanet) {
          ship.status = 'orbiting';
          continue;
        }
        updateShipOrbit(ship, targetPlanet, dt);
      }
    }
  }

  function updateOrbiting(dt: number) {
    for (const ship of context.world.ships) {
      if (!ship.mesh) continue;
      if (ship.status === 'engaging') {
        ship.mesh.rotation.y += dt * 0.8;
      }
      if (ship.status === 'docked') {
        ship.mesh.traverse((node: any) => {
          if (node.material && !Array.isArray(node.material) && 'emissiveIntensity' in node.material) {
            node.material.emissiveIntensity = 0.18;
          }
        });
      }
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
