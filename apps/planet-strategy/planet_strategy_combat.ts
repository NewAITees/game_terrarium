import { Color } from 'three';
import { scoreAttackTargets, stepPlanetStrategyMissiles } from './planet_strategy_wasm_bridge.js';

export function createPlanetStrategyCombatRuntime(context: any) {
  function getPlanetDefense(planet: any) {
    const turret = planet?.structures?.turret ?? 0;
    const factory = planet?.structures?.factory ?? 0;
    return {
      physDef: turret * 3 + factory,
      heatDef: factory * 3 + turret * 2,
    };
  }

  function damageFromAttack(attack: any, defense: any) {
    return Math.max(0, (attack.physAttack ?? attack.attack ?? 0) - (defense.physDef ?? defense.defense ?? 0))
      + Math.max(0, (attack.laserAttack ?? 0) - (defense.heatDef ?? defense.defense ?? 0));
  }

  function selectBattleTarget(ship: any, planet: any) {
    const enemies = context.world.ships.filter((other: any) =>
      other.owner !== ship.owner &&
      other.kind !== 'transport' &&
      other.status === 'engaging' &&
      other.targetPlanetId === planet.id
    );
    if (ship.kind === 'defender') {
      return enemies.sort((a: any, b: any) => context.distance3d(ship.position, a.position) - context.distance3d(ship.position, b.position))[0] ?? null;
    }
    if (ship.kind === 'gunship') {
      return enemies[0] ?? null;
    }
    return enemies[0] ?? null;
  }

  function createMissile(sourceShip: any, target: any, targetPlanet: any) {
    const missile = {
      id: `m${context.world.missileSerial++}`,
      owner: sourceShip.owner,
      sourceShipId: sourceShip.id,
      sourcePlanetId: sourceShip.homePlanetId ?? sourceShip.fromPlanetId ?? null,
      targetShipId: target?.kind ? target.id : null,
      targetPlanetId: targetPlanet?.id ?? null,
      x: sourceShip.position.x,
      y: sourceShip.position.y,
      z: sourceShip.position.z,
      speed: sourceShip.kind === 'gunship' ? 130 : sourceShip.kind === 'attacker' ? 112 : 95,
      hp: 6,
      maxHp: 6,
      physAttack: sourceShip.physAttack ?? sourceShip.attack ?? 0,
      laserAttack: sourceShip.laserAttack ?? 0,
      physDef: 0,
      heatDef: 0,
      life: 6,
      mesh: null,
      trailLine: null,
    };
    context.rendererView.attachMissileMesh?.(missile);
    context.world.missiles.push(missile);
  }

  function chooseAttackFleet(empire: any) {
    const ships = context.world.ships.filter((ship: any) =>
      ship.owner === empire.id &&
      (ship.kind === 'attacker' || ship.kind === 'gunship') &&
      (ship.status === 'orbiting' || ship.status === 'docked')
    );
    return ships;
  }

  function decideAttacks() {
    for (const empire of context.world.empires) {
      const myAttackers = chooseAttackFleet(empire);
      if (myAttackers.length < 3) continue;
      const goal = empire.goal ?? 'stabilize';
      if (goal === 'stabilize' && myAttackers.length < 6) continue;

      const ownedPlanets = context.world.planets.filter((planet: any) => planet.owner === empire.id);
      const base = context.getPlanet(empire.homeFactoryId)?.owner === empire.id
        ? context.getPlanet(empire.homeFactoryId)
        : ownedPlanets[0] ?? null;
      const enemyPlanets = context.world.planets.filter((planet: any) =>
        planet.owner !== empire.id &&
        planet.underConstruction?.empireId !== empire.id
      );
      if (!enemyPlanets.length) continue;

      const scored = enemyPlanets.map((planet: any) => {
        const defenderCount = context.world.ships.filter((ship: any) =>
          ship.homePlanetId === planet.id && ship.kind !== 'transport' &&
          (ship.status === 'orbiting' || ship.status === 'engaging' || ship.status === 'docked')
        ).length;
        const distanceBias = goal === 'pressure' ? 0.03 : goal === 'expand' ? 0.04 : 0.05;
        return { planet, score: defenderCount * 3 + context.distance3d(base ?? planet, planet) * distanceBias };
      });
      const wasmChoice = base
        ? scoreAttackTargets({
            base_x: base.x,
            base_y: base.y,
            base_z: base.z,
            candidates: scored.map((entry: any) => ({
              id: entry.planet.id,
              x: entry.planet.x,
              y: entry.planet.y,
              z: entry.planet.z,
              defender_count: context.world.ships.filter((ship: any) =>
                ship.homePlanetId === entry.planet.id && ship.kind !== 'transport' &&
                (ship.status === 'orbiting' || ship.status === 'engaging' || ship.status === 'docked')
              ).length,
            })),
          })
        : null;
      const target = wasmChoice?.best_index != null
        ? scored[wasmChoice.best_index]?.planet
        : scored.sort((a: any, b: any) => a.score - b.score)[0]?.planet;
      if (!target) continue;

      const fleetBias = goal === 'pressure' ? 0.8 : goal === 'expand' ? 0.65 : 0.48;
      const fleetSize = Math.max(2, Math.floor(myAttackers.length * fleetBias));
      const fleet = myAttackers.slice(0, fleetSize);
      if (base) context.touchRoute(base.id, target.id, 8, 16);
      empire.attackTargetLabel = target.label;
      empire.attackUntil = context.world.time + 25;

      for (const ship of fleet) {
        ship.status = 'launching';
        ship.targetPlanetId = target.id;
        ship.fromPlanetId = base?.id ?? ship.homePlanetId;
        ship.toPlanetId = target.id;
        ship.homePlanetId = base?.id ?? ship.homePlanetId;
        ship.progress = 0;
        ship.launchTimer = 0.2;
      }
      empire.intent = `${goal === 'pressure' ? 'pressuring' : goal === 'expand' ? 'testing' : 'attacking'} ${target.label} (fleet: ${fleetSize})`;
      context.logEvent(`${empire.name} launches ${fleetSize} attackers → ${target.label}!`, 'empire');
    }
  }

  function capturePlanet(planet: any, newOwner: number, fleet: any[]) {
    const oldName = planet.owner >= 0 ? (context.world.empires[planet.owner]?.name ?? '?') : 'neutral';
    planet.owner = newOwner;
    const newEmpire = context.world.empires[newOwner];

    if (planet.underConstruction && planet.underConstruction.empireId !== newOwner) {
      planet.underConstruction = null;
    }
    if (planet.type === 'mine' && planet.structures.mine <= 0) {
      planet.structures.mine = 1;
    }

    for (const ship of fleet) {
      ship.status = 'orbiting';
      ship.homePlanetId = planet.id;
      ship.targetPlanetId = null;
      ship.fromPlanetId = planet.id;
      ship.toPlanetId = planet.id;
      ship.mesh?.traverse((node: any) => {
        if (node.material && !Array.isArray(node.material)) {
          node.material.color?.set(newEmpire.color);
          node.material.emissive?.set(newEmpire.color);
        }
      });
    }
    if (planet.mesh) {
      planet.mesh.material.color.set(newEmpire.color);
      planet.mesh.material.emissive.set(new Color(newEmpire.color).multiplyScalar(0.18));
    }
    context.logEvent(`${newEmpire.name} captured ${planet.label} from ${oldName}!`, 'empire');
  }

  function fireShipWeapon(ship: any, planet: any) {
    const targetShip = selectBattleTarget(ship, planet);
    const targetPlanet = targetShip ? null : planet;
    if (!targetShip && !targetPlanet) return;
    createMissile(ship, targetShip, targetPlanet);
  }

  function updateMissiles(dt: number) {
    const targetLookup = new Map<string, { ship: any; planet: any; targetPos: any }>();
    const missilePayload = context.world.missiles.map((missile: any) => {
      const targetShip = missile.targetShipId ? context.world.ships.find((ship: any) => ship.id === missile.targetShipId) : null;
      const targetPlanet = missile.targetPlanetId ? context.getPlanet(missile.targetPlanetId) : null;
      const targetPos = targetShip?.position ?? targetPlanet ?? null;
      if (targetPos) targetLookup.set(missile.id, { ship: targetShip, planet: targetPlanet, targetPos });
      return targetPos
        ? { id: missile.id, x: missile.x, y: missile.y, z: missile.z, target_x: targetPos.x, target_y: targetPos.y ?? 0, target_z: targetPos.z, speed: missile.speed, life: missile.life }
        : null;
    }).filter(Boolean);

    const wasmResult = missilePayload.length
      ? stepPlanetStrategyMissiles({ dt, missiles: missilePayload })
      : null;

    const missileOutputs = wasmResult?.missiles ?? missilePayload.map((item: any) => ({
      id: item.id,
      x: item.x,
      y: item.y,
      z: item.z,
      life: item.life - dt,
      reached: false,
    }));

    const survivors: any[] = [];
    for (const output of missileOutputs) {
      const missile = context.world.missiles.find((entry: any) => entry.id === output.id);
      if (!missile) continue;
      missile.x = output.x;
      missile.y = output.y;
      missile.z = output.z;
      missile.life = output.life;
      if (missile.mesh) missile.mesh.position.set(missile.x, missile.y, missile.z);

      const targetInfo = targetLookup.get(missile.id);
      const targetShip = targetInfo?.ship ?? null;
      const targetPlanet = targetInfo?.planet ?? null;
      const targetPos = targetInfo?.targetPos ?? null;
      if (!targetPos || missile.life <= 0) {
        context.rendererView.removeMissileMesh?.(missile);
        continue;
      }

      const pdTargetPlanet = targetPlanet ?? (targetShip ? context.getPlanet(targetShip.homePlanetId) : null);
      if (pdTargetPlanet) {
        const defense = getPlanetDefense(pdTargetPlanet);
        const pdDamage = (pdTargetPlanet.structures.turret > 0 ? pdTargetPlanet.structures.turret * 5 : 0) * dt;
        missile.hp -= pdDamage;
        if (targetShip) {
          const defenders = context.world.ships.filter((ship: any) =>
            ship.owner === pdTargetPlanet.owner &&
            ship.kind === 'defender' &&
            (ship.status === 'orbiting' || ship.status === 'engaging') &&
            context.distance3d(ship.position, missile) < 26
          );
          if (defenders.length) missile.hp -= defenders.length * 8 * dt;
        }
        if (missile.hp <= 0) {
          context.rendererView.removeMissileMesh?.(missile);
          continue;
        }
        if (output.reached || context.distance3d(missile, targetPos) <= 5.5) {
          if (targetShip) {
            const damage = damageFromAttack(missile, targetShip);
            targetShip.hp -= damage;
          } else {
            const damage = damageFromAttack(missile, defense);
            if (pdTargetPlanet.structures.factory > 0) {
              pdTargetPlanet.factoryHp -= damage;
            } else if (pdTargetPlanet.owner >= 0 && pdTargetPlanet.structures.mine === 0) {
              pdTargetPlanet.stock = Math.max(0, pdTargetPlanet.stock - damage);
            }
          }
          context.rendererView.removeMissileMesh?.(missile);
          continue;
        }
      }

      survivors.push(missile);
    }
    context.world.missiles = survivors;
  }

  function resolveShipDeaths(planet: any) {
    const killed = context.world.ships.filter((ship: any) =>
      ship.hp <= 0 && ship.kind !== 'transport' &&
      (ship.status === 'orbiting' || ship.status === 'engaging' || ship.status === 'traveling' || ship.status === 'approaching' || ship.status === 'launching' || ship.status === 'docked')
    );
    for (const ship of killed) {
      context.rendererView.triggerShipFlash?.(ship);
      context.rendererView.removeShipMesh(ship);
      context.world.kills++;
      context.maybeLog(`kill:${ship.id}`, `A ${ship.kind} ship destroyed near ${planet.label}!`, 'warning', 1);
    }
    context.world.ships = context.world.ships.filter((ship: any) => ship.hp > 0 || ship.kind === 'transport');
  }

  function runCombat(dt: number) {
    for (const ship of context.world.ships) {
      if (ship.status === 'engaging') {
        const planet = context.getPlanet(ship.targetPlanetId ?? ship.homePlanetId);
        if (!planet) {
          ship.status = 'orbiting';
          continue;
        }
        const targetShip = selectBattleTarget(ship, planet);
        ship.fireCooldown = Math.max(0, (ship.fireCooldown ?? 0) - dt);
        if (ship.fireCooldown <= 0) {
          fireShipWeapon(ship, planet);
          ship.fireCooldown = ship.kind === 'gunship' ? 0.45 : ship.kind === 'defender' ? 0.55 : 0.7;
        }
        if (!targetShip && planet.structures.factory > 0) {
          planet.factoryHp -= damageFromAttack(ship, getPlanetDefense(planet)) * dt * 0.35;
        }
      }
    }

    updateMissiles(dt);
    resolveShipDeaths({ label: 'space' });

    const contested = new Set(
      context.world.ships.filter((ship: any) => ship.status === 'engaging').map((ship: any) => ship.targetPlanetId)
    );
    for (const planetId of contested) {
      const planet = context.getPlanet(planetId);
      if (!planet) continue;
      const attackers = context.world.ships.filter((ship: any) => ship.status === 'engaging' && ship.targetPlanetId === planetId && ship.owner !== planet.owner);
      if (attackers.length && planet.owner === attackers[0].owner) {
        for (const ship of attackers) {
          ship.status = 'orbiting';
          ship.targetPlanetId = null;
          ship.homePlanetId = planetId;
        }
        continue;
      }
      const defenders = context.world.ships.filter((ship: any) =>
        ship.owner === planet.owner &&
        ship.homePlanetId === planetId &&
        ship.kind !== 'transport' &&
        (ship.status === 'orbiting' || ship.status === 'engaging' || ship.status === 'docked')
      );

      const factoryAlive = () => planet.structures.factory > 0 && planet.factoryHp > 0;

      if (!defenders.length && attackers.length) {
        if (!factoryAlive()) {
          capturePlanet(planet, attackers[0].owner, attackers);
        } else if (planet.factoryHp <= 0) {
          planet.structures.factory = 0;
          planet.stalled = false;
          context.rendererView.triggerPlanetFlash?.(planet, 'destroyed');
          context.maybeLog(`factoryDown:${planet.id}`, `${planet.label} factory destroyed!`, 'warning', 1);
          capturePlanet(planet, attackers[0].owner, attackers);
        }
        continue;
      }

      for (const attacker of attackers) {
        const defender = defenders[Math.floor(context.rng() * defenders.length)] ?? null;
        if (defender) {
          defender.hp -= damageFromAttack(attacker, defender) * dt;
        }
        if (factoryAlive()) {
          planet.factoryHp -= damageFromAttack(attacker, getPlanetDefense(planet)) * dt * 0.4;
          if (planet.factoryHp <= 0) {
            planet.factoryHp = 0;
            planet.structures.factory = 0;
            planet.stalled = false;
            context.rendererView.triggerPlanetFlash?.(planet, 'destroyed');
            context.maybeLog(`factoryDown:${planet.id}`, `${planet.label} factory destroyed!`, 'warning', 1);
          }
        }
      }
      for (const defender of defenders) {
        if (!attackers.length) break;
        const attacker = attackers[Math.floor(context.rng() * attackers.length)];
        attacker.hp -= damageFromAttack(defender, attacker) * dt;
      }

      resolveShipDeaths(planet);

      const stillAttackers = context.world.ships.filter((ship: any) => ship.status === 'engaging' && ship.targetPlanetId === planetId);
      const stillDefenders = context.world.ships.filter((ship: any) =>
        ship.owner === planet.owner &&
        ship.homePlanetId === planetId &&
        ship.kind !== 'transport' &&
        (ship.status === 'orbiting' || ship.status === 'engaging' || ship.status === 'docked')
      );
      if (!stillDefenders.length && stillAttackers.length && !factoryAlive()) {
        capturePlanet(planet, stillAttackers[0].owner, stillAttackers);
      } else if (!stillAttackers.length && defenders.length) {
        context.maybeLog(`held:${planetId}`, `${planet.label} held — attack repelled!`, 'empire', 3);
      }
    }
  }

  return {
    decideAttacks,
    runCombat,
  };
}
