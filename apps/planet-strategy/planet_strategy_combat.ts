import { Color, } from 'three';

export function createPlanetStrategyCombatRuntime(context: any) {
  function decideAttacks() {
    for (const empire of context.world.empires) {
      const myAttackers = context.world.ships.filter((ship: any) =>
        ship.owner === empire.id && ship.kind === 'attacker' && ship.status === 'orbiting'
      );
      if (myAttackers.length < 3) continue;

      const ownedPlanets = context.world.planets.filter((planet: any) => planet.owner === empire.id);
      const base = context.getPlanet(empire.homeFactoryId)?.owner === empire.id
        ? context.getPlanet(empire.homeFactoryId)
        : ownedPlanets[0] ?? null;
      const enemyPlanets = context.world.planets.filter((planet: any) =>
        planet.owner !== empire.id &&
        planet.underConstruction?.empireId !== empire.id &&
        (!base || context.distance3d(base, planet) <= context.attackRange)
      );
      if (!enemyPlanets.length) continue;

      const scored = enemyPlanets.map((planet: any) => {
        const defenderCount = context.world.ships.filter((ship: any) =>
          ship.homePlanetId === planet.id && ship.kind !== 'transport' &&
          (ship.status === 'orbiting' || ship.status === 'battling')
        ).length;
        return { planet, score: defenderCount * 3 + context.distance3d(base ?? planet, planet) * 0.04 };
      });
      const target = scored.sort((a: any, b: any) => a.score - b.score)[0]?.planet;
      if (!target) continue;

      const fleetSize = Math.max(2, Math.floor(myAttackers.length * 0.65));
      const fleet = myAttackers.slice(0, fleetSize);
      if (base) context.touchRoute(base.id, target.id, 8);

      for (const ship of fleet) {
        ship.status = 'attacking';
        ship.targetPlanetId = target.id;
        ship.fromPlanetId = base?.id ?? ship.homePlanetId;
        ship.toPlanetId = target.id;
        ship.progress = 0;
      }
      empire.intent = `attacking ${target.label} (fleet: ${fleetSize})`;
      context.logEvent(`${empire.name} launches ${fleetSize} attackers → ${target.label}!`, 'empire');
    }
  }

  function capturePlanet(planet: any, newOwner: number, fleet: any[]) {
    const oldName = planet.owner >= 0 ? (context.world.empires[planet.owner]?.name ?? '?') : 'neutral';
    const wasNeutral = planet.owner < 0;
    planet.owner = newOwner;
    const newEmpire = context.world.empires[newOwner];

    if (wasNeutral && planet.structures.mine === 0 && planet.structures.factory === 0 && planet.resources > 0) {
      planet.type = 'mine';
      planet.structures.mine = 1;
    }
    planet.factoryHp = 0;
    if (planet.underConstruction && planet.underConstruction.empireId !== newOwner) {
      planet.underConstruction = null;
    }

    for (const ship of fleet) {
      ship.status = 'orbiting';
      ship.homePlanetId = planet.id;
      ship.targetPlanetId = null;
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

  function runCombat(dt: number) {
    for (const ship of context.world.ships) {
      if (ship.status !== 'attacking') continue;
      const target = context.getPlanet(ship.targetPlanetId);
      if (target && target.owner === ship.owner) {
        ship.status = 'orbiting';
        ship.homePlanetId = ship.fromPlanetId;
        ship.targetPlanetId = null;
        continue;
      }
      ship.progress = Math.min(1, ship.progress + dt * ship.speed);
      if (ship.progress >= 1) {
        ship.status = 'battling';
        ship.progress = 1;
      }
    }

    const contested = new Set(
      context.world.ships.filter((ship: any) => ship.status === 'battling').map((ship: any) => ship.targetPlanetId)
    );
    for (const planetId of contested) {
      const planet = context.getPlanet(planetId);
      if (!planet) continue;
      const attackers = context.world.ships.filter((ship: any) => ship.status === 'battling' && ship.targetPlanetId === planetId);
      if (attackers.length && planet.owner === attackers[0].owner) {
        for (const ship of attackers) {
          ship.status = 'orbiting';
          ship.targetPlanetId = null;
          ship.homePlanetId = planetId;
        }
        continue;
      }
      const defenders = context.world.ships.filter((ship: any) =>
        ship.owner === planet.owner && ship.homePlanetId === planetId &&
        ship.kind !== 'transport' && (ship.status === 'orbiting' || ship.status === 'battling')
      );

      const factoryAlive = () => planet.structures.factory > 0 && planet.factoryHp > 0;

      if (!defenders.length && attackers.length) {
        if (!factoryAlive()) {
          capturePlanet(planet, attackers[0].owner, attackers);
        } else {
          for (const attacker of attackers) {
            planet.factoryHp -= attacker.attack * 0.2 * dt;
          }
          if (planet.factoryHp <= 0) {
            planet.factoryHp = 0;
            planet.structures.factory = 0;
            planet.stalled = false;
            context.rendererView.triggerPlanetFlash?.(planet, 'destroyed');
            context.maybeLog(`factoryDown:${planet.id}`, `${planet.label} factory destroyed!`, 'warning', 1);
            capturePlanet(planet, attackers[0].owner, attackers);
          }
        }
        continue;
      }

      for (const attacker of attackers) {
        if (defenders.length) {
          const defender = defenders[Math.floor(context.rng() * defenders.length)];
          defender.hp -= Math.max(0, attacker.attack - defender.defense) * dt;
        }
        if (factoryAlive()) {
          planet.factoryHp -= attacker.attack * 0.1 * dt;
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
        attacker.hp -= Math.max(0, defender.attack - attacker.defense) * dt;
      }

      const killed = context.world.ships.filter((ship: any) =>
        ship.hp <= 0 && ship.kind !== 'transport' &&
        (ship.status === 'orbiting' || ship.status === 'battling' || ship.status === 'attacking')
      );
      for (const ship of killed) {
        context.rendererView.triggerShipFlash?.(ship);
        context.rendererView.removeShipMesh(ship);
        context.world.kills++;
        context.maybeLog(`kill:${ship.id}`, `A ${ship.kind} ship destroyed near ${planet.label}!`, 'warning', 1);
      }
      context.world.ships = context.world.ships.filter((ship: any) => ship.hp > 0 || ship.kind === 'transport');

      const stillAttackers = context.world.ships.filter((ship: any) => ship.status === 'battling' && ship.targetPlanetId === planetId);
      const stillDefenders = context.world.ships.filter((ship: any) =>
        ship.owner === planet.owner && ship.homePlanetId === planetId &&
        ship.kind !== 'transport' && (ship.status === 'orbiting' || ship.status === 'battling')
      );
      if (!stillDefenders.length && stillAttackers.length && !factoryAlive()) {
        capturePlanet(planet, stillAttackers[0].owner, stillAttackers);
      } else if (!stillAttackers.length && defenders.length) {
        context.maybeLog(`held:${planetId}`, `${planet.label} held — attack repelled!`, 'empire', 3);
      }
    }
  }

  return {
    capturePlanet,
    decideAttacks,
    runCombat,
  };
}
