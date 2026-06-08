import { createPlanetStrategyPlanetVisuals } from './planet_strategy_render_planets.js';
import { createPlanetStrategyShipVisuals } from './planet_strategy_render_ships.js';

export function createPlanetStrategyRenderVisuals(context: any) {
  const planetVisuals = createPlanetStrategyPlanetVisuals(context);
  const shipVisuals = createPlanetStrategyShipVisuals(context);

  shipVisuals.buildShipObjects();

  function updateVisuals(dt = 0): void {
    const contestedPlanets = new Set(
      context.world.ships
        .filter((ship: any) => ship.status === 'battling' || ship.status === 'attacking')
        .map((ship: any) => ship.targetPlanetId)
        .filter(Boolean)
    );

    planetVisuals.updatePlanetVisuals(contestedPlanets, dt);
    shipVisuals.updateRouteVisuals();
    shipVisuals.updateShipVisuals();
  }

  return {
    attachShipMesh: shipVisuals.attachShipMesh,
    ensureRouteVisual: shipVisuals.ensureRouteVisual,
    removeShipMesh: shipVisuals.removeShipMesh,
    updateVisuals,
  };
}
