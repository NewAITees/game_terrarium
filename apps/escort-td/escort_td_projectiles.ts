import {
  BufferGeometry,
  DoubleSide,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type { EscortTdLaserEvent, EscortTdPieceType, EscortTdProjectileSnapshot, EscortTdStateSnapshot } from '../../shared/types/escort_td.js';
import { CS } from './escort_td_core.js';

// ── per-projectile visual mesh + client-side interpolation state ──
type ProjMesh = {
  mesh: Mesh;
  unitType: EscortTdPieceType;
  // client-interpolated position (advances between server polls)
  x: number; z: number;
  fromX: number; fromZ: number;
  targetX: number; targetZ: number;
  dirX: number; dirZ: number;
  speed: number;
};

// ── short-lived impact / laser effect ──
interface Effect {
  isDone(): boolean;
  tick(dt: number): void;
  dispose(): void;
}

// Projectile visual colors per type
const PROJ_COLOR: Record<EscortTdPieceType, number> = {
  pawn:   0xffff88,
  knight: 0xff9944,
  bishop: 0xcc77ee,
  rook:   0xff8833,
  queen:  0xffe066,
};

export function createProjectileSystem(scene: Scene) {
  const projMeshes = new Map<number, ProjMesh>();
  const effects: Effect[] = [];

  // Called each server poll (~100 ms): sync projectile positions & handle impacts/lasers
  function syncState(state: EscortTdStateSnapshot): void {
    const incoming = new Map(state.projectiles.map((p) => [p.id, p]));

    // Detect disappeared projectiles → impact effect at last known position
    for (const [id, pm] of projMeshes) {
      if (!incoming.has(id)) {
        spawnImpact(scene, effects, pm.unitType, pm.x, pm.z, pm.fromX, pm.fromZ, pm.targetX, pm.targetZ);
        scene.remove(pm.mesh);
        pm.mesh.geometry.dispose();
        (pm.mesh.material as MeshBasicMaterial).dispose();
        projMeshes.delete(id);
      }
    }

    // Create or update meshes from server snapshot
    for (const snap of state.projectiles) {
      let pm = projMeshes.get(snap.id);
      if (!pm) {
        const geo = new SphereGeometry(projRadius(snap.unitType), 6, 4);
        const mat = new MeshBasicMaterial({ color: PROJ_COLOR[snap.unitType] });
        const mesh = new Mesh(geo, mat);
        scene.add(mesh);
        pm = { mesh, unitType: snap.unitType, x: snap.x, z: snap.z, fromX: snap.fromX, fromZ: snap.fromZ, targetX: snap.targetX, targetZ: snap.targetZ, dirX: snap.dirX, dirZ: snap.dirZ, speed: snap.speed };
        projMeshes.set(snap.id, pm);
      }
      // Authoritative position from server
      pm.x = snap.x; pm.z = snap.z;
      pm.fromX = snap.fromX; pm.fromZ = snap.fromZ;
      pm.targetX = snap.targetX; pm.targetZ = snap.targetZ;
      pm.dirX = snap.dirX; pm.dirZ = snap.dirZ;
      pm.speed = snap.speed;
      pm.mesh.position.set(snap.x, projY(snap), snap.z);
    }

    // Laser events (Queen instant beam)
    for (const ev of state.laserEvents) {
      effects.push(makeLaser(scene, ev));
    }
  }

  // Called each animation frame: client-side interpolation + tick effects
  function tick(dt: number): void {
    for (const pm of projMeshes.values()) {
      pm.x += pm.dirX * pm.speed * dt;
      pm.z += pm.dirZ * pm.speed * dt;
      pm.mesh.position.set(pm.x, projYfromPM(pm), pm.z);
    }

    for (let i = effects.length - 1; i >= 0; i--) {
      effects[i].tick(dt);
      if (effects[i].isDone()) {
        effects[i].dispose();
        effects.splice(i, 1);
      }
    }
  }

  return { syncState, tick };
}

// ── Y height per projectile type ──
function projRadius(type: EscortTdPieceType): number {
  if (type === 'queen') return CS * 0.22;
  if (type === 'rook') return CS * 0.15;
  if (type === 'bishop') return CS * 0.12;
  return CS * 0.07;
}

function projY(snap: EscortTdProjectileSnapshot): number {
  if (snap.unitType === 'rook') return arcY(snap.x, snap.z, snap.fromX, snap.fromZ, snap.targetX, snap.targetZ, CS * 3.0);
  if (snap.unitType === 'bishop') return arcY(snap.x, snap.z, snap.fromX, snap.fromZ, snap.targetX, snap.targetZ, CS * 0.6) + CS * 0.4;
  return CS * 0.3;
}

function projYfromPM(pm: ProjMesh): number {
  if (pm.unitType === 'rook') return arcY(pm.x, pm.z, pm.fromX, pm.fromZ, pm.targetX, pm.targetZ, CS * 3.0);
  if (pm.unitType === 'bishop') return arcY(pm.x, pm.z, pm.fromX, pm.fromZ, pm.targetX, pm.targetZ, CS * 0.6) + CS * 0.4;
  return CS * 0.3;
}

function arcY(x: number, z: number, fx: number, fz: number, tx: number, tz: number, peak: number): number {
  const total = Math.hypot(tx - fx, tz - fz);
  if (total < 0.001) return CS * 0.2;
  const traveled = Math.hypot(x - fx, z - fz);
  const t = Math.min(1, traveled / total);
  return Math.sin(t * Math.PI) * peak + CS * 0.2;
}

// ── Impact effects ──
function spawnImpact(
  scene: Scene, effects: Effect[],
  type: EscortTdPieceType, x: number, z: number,
  fromX: number, fromZ: number, targetX: number, targetZ: number,
): void {
  if (type === 'rook') {
    effects.push(makeRing(scene, x, z, CS * 1.8, 0.28, 0xff5522));
  } else if (type === 'bishop') {
    effects.push(makeRing(scene, x, z, CS * 0.7, 0.14, 0xee44ff));
  } else if (type === 'pawn' || type === 'knight') {
    effects.push(makeFlash(scene, x, z, type === 'pawn' ? 0xffff88 : 0xff9944));
  }
}

// Expanding ring that fades
function makeRing(scene: Scene, x: number, z: number, maxR: number, duration: number, color: number): Effect {
  const geo = new RingGeometry(0, maxR, 20);
  const mat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: DoubleSide });
  const mesh = new Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.18, z);
  scene.add(mesh);
  let age = 0;
  return {
    isDone: () => age >= duration,
    tick(dt) {
      age += dt;
      const t = age / duration;
      mesh.scale.setScalar(t);
      mat.opacity = Math.max(0, 0.9 * (1 - t));
    },
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
    },
  };
}

// Brief flash sphere for pawn/knight hits
function makeFlash(scene: Scene, x: number, z: number, color: number): Effect {
  const geo = new SphereGeometry(CS * 0.25, 6, 4);
  const mat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
  const mesh = new Mesh(geo, mat);
  mesh.position.set(x, CS * 0.3, z);
  scene.add(mesh);
  let age = 0;
  const DURATION = 0.09;
  return {
    isDone: () => age >= DURATION,
    tick(dt) {
      age += dt;
      mat.opacity = Math.max(0, 0.9 * (1 - age / DURATION));
      mesh.scale.setScalar(1 + age / DURATION * 1.5);
    },
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
    },
  };
}

// Queen laser beam: line + AoE ring flash
function makeLaser(scene: Scene, ev: EscortTdLaserEvent): Effect {
  const points = [
    new Vector3(ev.fromX, CS * 0.5, ev.fromZ),
    new Vector3(ev.toX, CS * 0.5, ev.toZ),
  ];
  const lineGeo = new BufferGeometry().setFromPoints(points);
  const lineMat = new LineBasicMaterial({ color: 0xffe066, transparent: true, opacity: 1 });
  const line = new Line(lineGeo, lineMat);
  scene.add(line);

  const ringGeo = new RingGeometry(0, ev.aoeRadius || CS * 3.2, 24);
  const ringMat = new MeshBasicMaterial({ color: 0xffa500, transparent: true, opacity: 0.85, side: DoubleSide });
  const ring = new Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(ev.toX, 0.18, ev.toZ);
  scene.add(ring);

  let age = 0;
  const DURATION = 0.35;
  return {
    isDone: () => age >= DURATION,
    tick(dt) {
      age += dt;
      const t = age / DURATION;
      lineMat.opacity = Math.max(0, 1 - t * 2);
      ring.scale.setScalar(t);
      ringMat.opacity = Math.max(0, 0.85 * (1 - t));
    },
    dispose() {
      scene.remove(line);
      scene.remove(ring);
      lineGeo.dispose();
      lineMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
    },
  };
}
