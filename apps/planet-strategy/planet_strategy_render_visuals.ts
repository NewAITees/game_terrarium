import { Color, Group, Mesh, MeshBasicMaterial, SphereGeometry, TorusGeometry } from 'three';
import { createPlanetFlashEffect, createPlanetStrategyPlanetVisuals } from './planet_strategy_render_planets.js';
import { createPlanetStrategyShipVisuals } from './planet_strategy_render_ships.js';
import { loadStructureAsset, normalizeAssetInstance } from './planet_strategy_render_assets.js';

export function createPlanetStrategyRenderVisuals(context: any) {
  const planetVisuals = createPlanetStrategyPlanetVisuals(context);
  const shipVisuals = createPlanetStrategyShipVisuals(context);
  const transientEffects: any[] = [];
  const effectGroup = context.shipGroup;
  let impactAsset: any = null;
  void loadStructureAsset('assets/structures/crystals.glb').then((asset) => {
    impactAsset = asset;
  });

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

  function triggerMissileHit(position: any, colorValue = '#fff0c0'): void {
    const flash = createMissileHitEffect(position, colorValue, impactAsset);
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

  function createMissileHitEffect(position: any, colorValue: string, asset: any) {
    const color = new Color(colorValue);
    const mesh = new Group();
    mesh.position.set(position.x, position.y, position.z);

    const core = new Mesh(
      new SphereGeometry(0.32, 10, 10),
      new MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false })
    );
    mesh.add(core);

    const ring = new Mesh(
      new TorusGeometry(0.58, 0.08, 8, 18),
      new MeshBasicMaterial({ color, transparent: true, opacity: 0.62, depthWrite: false })
    );
    ring.rotation.x = Math.PI / 2;
    mesh.add(ring);

    if (asset) {
      const shard = normalizeAssetInstance(asset, 1.15);
      shard.rotation.x = Math.PI * 0.5;
      shard.rotation.y = Math.PI * 0.25;
      tintEffectObject(shard, color);
      mesh.add(shard);
    }

    return {
      mesh,
      life: 0.24,
      maxLife: 0.24,
      update(progress: number, dt: number) {
        const t = Math.max(0, Math.min(1, progress));
        const pulse = 1 + (1 - t) * 1.8;
        mesh.scale.setScalar(pulse);
        mesh.rotation.y += dt * 2.8;
        core.material.opacity = 0.9 * t;
        ring.material.opacity = 0.72 * t;
      },
      dispose() {
        mesh.traverse((node: any) => {
          node.geometry?.dispose?.();
          if (Array.isArray(node.material)) {
            for (const material of node.material) material?.dispose?.();
          } else {
            node.material?.dispose?.();
          }
        });
      },
    };
  }

  function tintEffectObject(root: any, color: Color): void {
    root.traverse((node: any) => {
      if (!node.material) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if ('color' in material && material.color) material.color.lerp(color, 0.3);
        if ('emissive' in material && material.emissive) material.emissive.copy(color).multiplyScalar(0.3);
        if ('emissiveIntensity' in material) material.emissiveIntensity = Math.max(material.emissiveIntensity ?? 0, 0.22);
      }
    });
  }

  return {
    attachMissileMesh: shipVisuals.attachMissileMesh,
    attachShipMesh: shipVisuals.attachShipMesh,
    ensureRouteVisual: shipVisuals.ensureRouteVisual,
    removeMissileMesh: shipVisuals.removeMissileMesh,
    removeShipMesh: shipVisuals.removeShipMesh,
    triggerPlanetFlash,
    triggerMissileHit,
    triggerShipFlash,
    updateVisuals,
  };
}
