import { createPlanetFlashEffect, createPlanetStrategyPlanetVisuals } from './planet_strategy_render_planets.js';
import { createPlanetStrategyShipVisuals } from './planet_strategy_render_ships.js';

export function createPlanetStrategyRenderVisuals(context: any) {
  const planetVisuals = createPlanetStrategyPlanetVisuals(context);
  const shipVisuals = createPlanetStrategyShipVisuals(context);
  const transientEffects: any[] = [];
  const effectGroup = context.shipGroup;

  shipVisuals.buildShipObjects();

  function triggerShipFlash(ship: any): void {
    const position = ship.mesh?.position?.clone?.();
    if (!position) return;
    const flash = shipVisuals.createShipFlash(ship);
    flash.mesh.position.copy(position);
    effectGroup.add(flash.mesh);
    transientEffects.push(flash);
  }

  function triggerPlanetFlash(planet: any, kind = 'damage'): void {
    const flash = createPlanetFlashEffect(planet, kind);
    effectGroup.add(flash.mesh);
    transientEffects.push(flash);
  }

  function updateTransientEffects(dt: number): void {
    for (let i = transientEffects.length - 1; i >= 0; i--) {
      const effect = transientEffects[i];
      effect.life -= dt;
      effect.update(effect.life / effect.maxLife, dt);
      if (effect.life > 0) continue;
      effectGroup.remove(effect.mesh);
      effect.dispose?.();
      transientEffects.splice(i, 1);
    }
  }

  function updateVisuals(dt = 0): void {
    const contestedPlanets = new Set(
      context.world.ships
        .filter((ship: any) => ship.status === 'engaging')
        .map((ship: any) => ship.targetPlanetId)
        .filter(Boolean)
    );

    updateTransientEffects(dt);
    planetVisuals.updatePlanetVisuals(contestedPlanets, dt);
    shipVisuals.updateRouteVisuals();
    shipVisuals.updateShipVisuals();
    shipVisuals.updateMissileVisuals();
  }

  return {
    attachMissileMesh: shipVisuals.attachMissileMesh,
    attachShipMesh: shipVisuals.attachShipMesh,
    ensureRouteVisual: shipVisuals.ensureRouteVisual,
    removeMissileMesh: shipVisuals.removeMissileMesh,
    removeShipMesh: shipVisuals.removeShipMesh,
    triggerPlanetFlash,
    triggerShipFlash,
    updateVisuals,
  };
}
