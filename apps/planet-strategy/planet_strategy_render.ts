import { createPlanetStrategyRenderScene } from './planet_strategy_render_scene.js';
import { createPlanetStrategyRenderVisuals } from './planet_strategy_render_visuals.js';
import type {
  PlanetStrategyRenderer,
  PlanetStrategyRendererDeps,
} from '../../shared/types/planet_strategy.js';

export function createPlanetStrategyRenderer({
  world,
  rng,
  getPlanet,
  distance3d,
  routeKey,
}: PlanetStrategyRendererDeps): PlanetStrategyRenderer {
  const {
    camera,
    composer,
    controls,
    planetGroup,
    renderer,
    routeGroup,
    scene,
    shipGroup,
  } = createPlanetStrategyRenderScene();
  const {
    attachMissileMesh,
    attachShipMesh,
    ensureRouteVisual,
    removeMissileMesh,
    removeShipMesh,
    triggerPlanetFlash,
    triggerMissileHit,
    triggerShipFlash,
    updateVisuals,
  } = createPlanetStrategyRenderVisuals({
    camera,
    composer,
    controls,
    distance3d,
    getPlanet,
    planetGroup,
    renderer,
    rng,
    routeGroup,
    routeKey,
    scene,
    shipGroup,
    world,
  });

  function renderFrame(): void {
    controls.update();
    composer.render();
  }

  function onResize(): void {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  }

  return {
    attachMissileMesh,
    attachShipMesh,
    ensureRouteVisual,
    removeMissileMesh,
    removeShipMesh,
    triggerPlanetFlash,
    triggerMissileHit,
    triggerShipFlash,
    renderFrame,
    updateVisuals,
    onResize,
  };
}
