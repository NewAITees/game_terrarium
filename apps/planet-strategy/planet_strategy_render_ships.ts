import {
  BufferGeometry,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { loadShipAsset, normalizeAssetInstance } from './planet_strategy_render_assets.js';

export function createPlanetStrategyShipVisuals(context: any) {
  type WeaponPalette = {
    core: number;
    trail: number;
    trailOpacity: number;
    lineWidth: number;
    coreScale: number;
  };
  const shipAssetPaths: Record<string, string> = {
    transport: 'assets/ships/transport.glb',
    attacker: 'assets/ships/attacker.glb',
    defender: 'assets/ships/defender.glb',
    gunship: 'assets/ships/defender.glb',
  };

  function makeShipMesh(empire: any, kind = 'transport') {
    const root = new Group();
    root.userData.shipKind = kind;
    void applyShipAsset(root, empire.color, kind);
    return root;
  }

  async function applyShipAsset(root: Group, colorValue: string, kind: string): Promise<void> {
    const path = shipAssetPaths[kind];
    if (!path) return;
    const asset = await loadShipAsset(path);
    if (!asset) {
      console.error(`Ship asset missing: ${path}`);
      return;
    }
    root.clear();
    const instance = normalizeAssetInstance(asset, kind === 'transport' ? 2.9 : kind === 'gunship' ? 3.3 : 3.5);
    instance.rotation.y = Math.PI;
    tintShipAsset(instance, colorValue);
    root.add(instance);
  }

  function attachShipMesh(ship: any, empire: any): void {
    const mesh = makeShipMesh(empire, ship.kind);
    context.shipGroup.add(mesh);
    ship.mesh = mesh;
    ship.trailPoints = [];
    ship.trailLine = createTrailLine(empire.color, ship.kind === 'gunship' ? 0.45 : 0.32);
    context.shipGroup.add(ship.trailLine);
    syncShipMesh(ship);
  }

  function attachMissileMesh(missile: any): void {
    const palette = getWeaponPalette(missile.weaponKind, missile.laserAttack ?? 0, missile.physAttack ?? 0);
    const mesh = new Mesh(
      new SphereGeometry(0.18, 8, 8),
      new MeshBasicMaterial({
        color: palette.core,
        transparent: true,
        opacity: 0.98,
        depthWrite: false,
      })
    );
    context.shipGroup.add(mesh);
    missile.mesh = mesh;
    missile.trailPoints = [];
    missile.trailLine = createTrailLine(palette.trail, palette.trailOpacity, palette.lineWidth);
    context.shipGroup.add(missile.trailLine);
    mesh.position.set(missile.x, missile.y, missile.z);
    mesh.scale.setScalar(palette.coreScale);
    missile.mesh.userData.weaponKind = missile.weaponKind ?? 'attacker';
    missile.mesh.userData.weaponPalette = palette;
  }

  function syncShipMesh(ship: any) {
    if (!ship.mesh || !ship.position) return;
    ship.mesh.position.set(ship.position.x, ship.position.y, ship.position.z);
  }

  function removeMissileMesh(missile: any): void {
    if (missile.trailLine) {
      context.shipGroup.remove(missile.trailLine);
      missile.trailLine.geometry?.dispose();
      missile.trailLine.material?.dispose();
      missile.trailLine = null;
    }
    if (missile.mesh) {
      context.shipGroup.remove(missile.mesh);
      missile.mesh.geometry?.dispose?.();
      missile.mesh.material?.dispose?.();
      missile.mesh = null;
    }
  }

  function removeShipMesh(ship: any): void {
    if (ship.trailLine) {
      context.shipGroup.remove(ship.trailLine);
      ship.trailLine.geometry?.dispose();
      ship.trailLine.material?.dispose();
      ship.trailLine = null;
    }
    if (!ship.mesh) return;
    context.shipGroup.remove(ship.mesh);
    ship.mesh.traverse((node: any) => {
      node.geometry?.dispose?.();
      if (Array.isArray(node.material)) {
        for (const material of node.material) material?.dispose?.();
      } else {
        node.material?.dispose?.();
      }
    });
    ship.mesh = null;
  }

  function ensureRouteVisual(route: any): void {
    if (route.line && route.curve) return;
    const from = context.getPlanet(route.fromPlanetId);
    const to = context.getPlanet(route.toPlanetId);
    if (!from || !to) return;
    const p0 = new Vector3(from.x, from.y, from.z);
    const p2 = new Vector3(to.x, to.y, to.z);
    const mid = p0.clone().lerp(p2, 0.5);
    mid.y += 18 + context.distance3d(from, to) * 0.06;
    const curve = new Vector3().copy(mid);
    const geometry = new BufferGeometry().setFromPoints([
      p0,
      mid,
      p2,
    ]);
    const material = new LineBasicMaterial({ color: 0x35627c, transparent: true, opacity: 0.15 });
    const line = new Line(geometry, material);
    const glow = new Line(
      geometry.clone(),
      new LineBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.08 })
    );
    context.routeGroup.add(line);
    context.routeGroup.add(glow);
    route.line = line;
    route.glow = glow;
    route.curve = {
      getPoint(t: number) {
        return new Vector3(
          from.x + (to.x - from.x) * t,
          from.y + (to.y - from.y) * t + Math.sin(Math.PI * t) * mid.y * 0.03,
          from.z + (to.z - from.z) * t
        );
      },
      getTangent(t: number) {
        return new Vector3(to.x - from.x, to.y - from.y, to.z - from.z).normalize();
      },
    };
  }

  function buildShipObjects() {
    for (const ship of context.world.ships) {
      attachShipMesh(ship, context.world.empires[ship.owner]);
    }
  }

  function updateRouteVisuals(): void {
    for (const route of context.world.routes.values()) {
      if (!route.line) continue;
      const hot = Math.min(route.traffic / 14, 1);
      route.line.material.opacity = 0.06 + hot * 0.34;
      route.line.material.color.set(route.traffic > 10 ? 0x9fe6ff : route.traffic > 4 ? 0x5ca8c8 : 0x30556b);
      if (route.glow) {
        route.glow.material.opacity = 0.04 + hot * 0.28;
        route.glow.material.color.set(route.traffic > 10 ? 0xe7fbff : 0x82d6ff);
      }
    }
  }

  function updateShipVisuals(): void {
    for (const ship of context.world.ships) {
      if (!ship.mesh) continue;
      syncShipMesh(ship);
      if (ship.position) ship.mesh.position.set(ship.position.x, ship.position.y, ship.position.z);

      const direction = new Vector3();
      if (ship.status === 'traveling' || ship.status === 'approaching' || ship.status === 'launching') {
        const from = context.getPlanet(ship.fromPlanetId);
        const to = context.getPlanet(ship.toPlanetId);
        if (from && to) {
          direction.set(to.x - from.x, to.y - from.y, to.z - from.z).normalize();
          ship.mesh.rotation.y = Math.atan2(direction.x, direction.z);
        }
      } else if (ship.status === 'engaging') {
        ship.mesh.rotation.y += 0.02;
      }
      ship.mesh.scale.setScalar(ship.status === 'engaging' ? 1.08 : 1);
      updateTrail(ship);
    }
  }

  function updateMissileVisuals(): void {
    for (const missile of context.world.missiles) {
      if (!missile.mesh) continue;
      const palette = missile.mesh.userData.weaponPalette ?? getWeaponPalette(missile.weaponKind, missile.laserAttack ?? 0, missile.physAttack ?? 0);
      missile.mesh.position.set(missile.x, missile.y, missile.z);
      missile.mesh.scale.setScalar(palette.coreScale * (0.95 + Math.sin(performance.now() / 90) * 0.12));
      if (missile.mesh.material) missile.mesh.material.color.set(palette.core);
      if (missile.trailLine?.material) {
        missile.trailLine.material.color.set(palette.trail);
        missile.trailLine.material.opacity = palette.trailOpacity;
        missile.trailLine.material.linewidth = palette.lineWidth;
      }
      updateMissileTrail(missile);
    }
  }

  function updateMissileTrail(missile: any) {
    if (!missile.trailLine || !missile.mesh) return;
    const point = missile.mesh.position.clone();
    missile.trailPoints.push(point);
    while (missile.trailPoints.length > 8) missile.trailPoints.shift();
    if (missile.trailPoints.length < 2) return;
    missile.trailLine.geometry.dispose();
    missile.trailLine.geometry = new BufferGeometry().setFromPoints(missile.trailPoints);
    missile.trailLine.material.opacity = 0.26;
  }

  function tintShipAsset(root: any, colorValue: string): void {
    const color = new Color(colorValue);
    root.traverse((node: any) => {
      if (!node.material) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if ('color' in material && material.color) material.color.lerp(color, 0.35);
        if ('emissive' in material && material.emissive) material.emissive.copy(color).multiplyScalar(0.2);
        if ('emissiveIntensity' in material) material.emissiveIntensity = Math.max(material.emissiveIntensity ?? 0, 0.18);
      }
    });
  }

  function getWeaponPalette(kind: string | undefined, laserAttack: number, physAttack: number): WeaponPalette {
    if (kind === 'gunship') {
      return { core: 0x8feeff, trail: 0x56d7ff, trailOpacity: 0.48, lineWidth: 2.2, coreScale: 1.15 };
    }
    if (kind === 'defender') {
      return { core: 0xb8ffcf, trail: 0x72f0a5, trailOpacity: 0.42, lineWidth: 1.8, coreScale: 1.05 };
    }
    if (kind === 'attacker') {
      return { core: 0xffd28f, trail: 0xffa43b, trailOpacity: 0.36, lineWidth: 1.4, coreScale: 0.98 };
    }
    if (laserAttack > physAttack) {
      return { core: 0xa9f0ff, trail: 0x5ed6ff, trailOpacity: 0.4, lineWidth: 1.7, coreScale: 1.02 };
    }
    return { core: 0xfff2c4, trail: 0xffe3a3, trailOpacity: 0.3, lineWidth: 1.1, coreScale: 0.92 };
  }

  return {
    attachMissileMesh,
    attachShipMesh,
    buildShipObjects,
    createShipFlash,
    ensureRouteVisual,
    removeMissileMesh,
    removeShipMesh,
    updateMissileVisuals,
    updateRouteVisuals,
    updateShipVisuals,
  };
}

function createShipFlash(ship: any) {
  const mesh = new Mesh(
    new SphereGeometry(ship.kind === 'attacker' ? 1.4 : ship.kind === 'gunship' ? 1.25 : 1.1, 12, 12),
    new MeshBasicMaterial({
      color: ship.kind === 'defender' ? 0xffc8a0 : 0xfff0d8,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    })
  );
  return {
    mesh,
    life: 0.14,
    maxLife: 0.14,
    update(progress: number) {
      const t = Math.max(0, Math.min(1, progress));
      mesh.scale.setScalar(0.8 + (1 - t) * 1.9);
      mesh.material.opacity = 0.92 * t;
    },
    dispose() {
      mesh.geometry.dispose();
      mesh.material.dispose();
    },
  };
}

  function createTrailLine(color: any, opacity: number, linewidth = 1) {
    const material = new LineBasicMaterial({
      color: new Color(color),
      transparent: true,
      opacity,
    });
    material.linewidth = linewidth;
    const geometry = new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]);
    return new Line(geometry, material);
  }

  function updateTrail(ship: any) {
    if (!ship.trailLine || !ship.mesh) return;
    const point = ship.mesh.position.clone();
    ship.trailPoints.push(point);
    while (ship.trailPoints.length > 12) ship.trailPoints.shift();
    if (ship.trailPoints.length < 2) return;
    ship.trailLine.geometry.dispose();
    ship.trailLine.geometry = new BufferGeometry().setFromPoints(ship.trailPoints);
    ship.trailLine.material.opacity = ship.status === 'engaging' ? 0.58 : 0.32;
  }

  function getWeaponPalette(kind: string | undefined, laserAttack: number, physAttack: number) {
    if (kind === 'gunship') {
      return { core: 0x8feeff, trail: 0x56d7ff, trailOpacity: 0.48, lineWidth: 2.2, coreScale: 1.15 };
    }
    if (kind === 'defender') {
      return { core: 0xb8ffcf, trail: 0x72f0a5, trailOpacity: 0.42, lineWidth: 1.8, coreScale: 1.05 };
    }
    if (kind === 'attacker') {
      return { core: 0xffd28f, trail: 0xffa43b, trailOpacity: 0.36, lineWidth: 1.4, coreScale: 0.98 };
    }
    if (laserAttack > physAttack) {
      return { core: 0xa9f0ff, trail: 0x5ed6ff, trailOpacity: 0.4, lineWidth: 1.7, coreScale: 1.02 };
    }
    return { core: 0xfff2c4, trail: 0xffe3a3, trailOpacity: 0.3, lineWidth: 1.1, coreScale: 0.92 };
  }
