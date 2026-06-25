import { Box3,BoxGeometry,CylinderGeometry,Group,Mesh,MeshBasicMaterial,MeshLambertMaterial,MeshStandardMaterial,Object3D,RingGeometry,TorusGeometry,Vector3, } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { type EnemyKind, type PieceType } from './escort_td_core.js';

type EscortSide = 'ally' | 'enemy';

const loader = new GLTFLoader();
const assetCache = new Map<string, Promise<Object3D | null>>();

const unitAssetPaths: Record<PieceType | EnemyKind, string> = {
  pawn: '/assets/ships/transport.glb',
  rook: '/assets/structures/turret.glb',
  bishop: '/assets/ships/attacker.glb',
  knight: '/assets/ships/defender.glb',
  queen: '/assets/structures/station.glb',
  ground: '/assets/ships/transport.glb',
  air: '/assets/ships/attacker.glb',
  siege: '/assets/structures/factory.glb',
};

const sidePalette: Record<EscortSide, { base: number; accent: number; emissive: number }> = {
  ally: { base: 0x8fdfff, accent: 0x2ef7d8, emissive: 0x0f4f5e },
  enemy: { base: 0xff8a66, accent: 0xff3d3d, emissive: 0x5d1111 },
};

export function createEscortUnitVisual(type: PieceType, side: EscortSide): Group {
  return createVisual(type, side);
}

export function createEscortEnemyVisual(kind: EnemyKind): Group {
  return createVisual(kind, 'enemy');
}

export function setEscortUnitAim(root: Object3D, aimFacing: number): void {
  const marker = root.getObjectByName('escort-aim-marker');
  if (!marker) return;
  marker.rotation.y = aimFacing - root.rotation.y;
}

function createVisual(key: PieceType | EnemyKind, side: EscortSide): Group {
  const root = new Group();
  root.name = `${side}-${key}`;
  root.add(buildFallbackVisual(key, side));
  void loadAsset(key).then((asset) => {
    if (!asset) return;
    root.clear();
    const instance = normalizeAssetInstance(asset, sizeFor(key));
    tintObject(instance, side);
    if (key === 'knight') addMechDetails(instance, side);
    addGroundRing(instance, side, key);
    if (side === 'ally') addAimMarker(instance, side, key);
    root.add(instance);
  });
  return root;
}

function loadAsset(key: PieceType | EnemyKind): Promise<Object3D | null> {
  const path = unitAssetPaths[key];
  if (!assetCache.has(path)) {
    assetCache.set(
      path,
      loader.loadAsync(path)
        .then((gltf: any) => gltf.scene ?? null)
        .catch((error: unknown) => {
          console.warn(`Failed to load escort asset: ${path}`, error);
          return null;
        })
    );
  }
  return assetCache.get(path)!;
}

function buildFallbackVisual(key: PieceType | EnemyKind, side: EscortSide): Group {
  const palette = sidePalette[side];
  const group = new Group();
  const bodyMat = new MeshStandardMaterial({ color: palette.base, emissive: palette.emissive, emissiveIntensity: 0.35, metalness: 0.25, roughness: 0.45 });
  const accentMat = new MeshStandardMaterial({ color: palette.accent, emissive: palette.emissive, emissiveIntensity: 0.45, metalness: 0.35, roughness: 0.3 });
  const darkMat = new MeshStandardMaterial({ color: side === 'ally' ? 0x0e1b25 : 0x2a100f, emissive: palette.emissive, emissiveIntensity: 0.15, metalness: 0.1, roughness: 0.8 });

  switch (key) {
    case 'pawn':
    case 'ground':
      group.add(new Mesh(new CylinderGeometry(0.75, 0.95, 1.4, 8), bodyMat));
      group.add(new Mesh(new CylinderGeometry(0.35, 0.45, 0.7, 8), accentMat));
      break;
    case 'rook':
    case 'siege':
      group.add(new Mesh(new BoxGeometry(1.2, 0.55, 1.2), darkMat));
      group.add(new Mesh(new CylinderGeometry(0.55, 0.65, 1.0, 14), bodyMat));
      group.add(new Mesh(new CylinderGeometry(0.18, 0.22, 0.6, 10), accentMat));
      break;
    case 'bishop':
    case 'air':
      group.add(new Mesh(new BoxGeometry(0.42, 0.9, 1.65), bodyMat));
      group.add(new Mesh(new CylinderGeometry(0.15, 0.18, 1.5, 10), accentMat));
      break;
    case 'knight':
      group.add(new Mesh(new BoxGeometry(0.9, 1.05, 0.65), bodyMat));
      group.add(new Mesh(new BoxGeometry(0.32, 0.42, 0.32), accentMat));
      group.add(new Mesh(new CylinderGeometry(0.14, 0.18, 1.0, 8), darkMat));
      group.add(new Mesh(new CylinderGeometry(0.14, 0.18, 1.0, 8), darkMat));
      break;
    case 'queen':
      group.add(new Mesh(new CylinderGeometry(1.0, 1.25, 1.6, 16), bodyMat));
      group.add(new Mesh(new CylinderGeometry(0.4, 0.5, 0.65, 10), accentMat));
      group.add(new Mesh(new TorusGeometry(1.1, 0.08, 8, 18), darkMat));
      break;
  }

  group.traverse((node: any) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  normalizeGroup(group, key);
  addGroundRing(group, side, key);
  if (side === 'ally') addAimMarker(group, side, key);
  if (key === 'knight') addMechDetails(group, side);
  return group;
}

function normalizeAssetInstance(root: Object3D, targetSize: number): Object3D {
  const instance = root.clone(true);
  const box = new Box3().setFromObject(instance);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const largest = Math.max(size.x, size.y, size.z, 0.0001);
  const scale = targetSize / largest;
  instance.position.sub(center);
  instance.scale.setScalar(scale);
  instance.traverse((node: any) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
      if (node.material && !Array.isArray(node.material)) {
        node.material = node.material.clone();
      }
    }
  });
  instance.rotation.y = Math.PI;
  return instance;
}

function normalizeGroup(group: Group, key: PieceType | EnemyKind): void {
  const box = new Box3().setFromObject(group);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const largest = Math.max(size.x, size.y, size.z, 0.0001);
  const target = sizeFor(key);
  group.position.sub(center);
  group.scale.setScalar(target / largest);
}

function sizeFor(key: PieceType | EnemyKind): number {
  switch (key) {
    case 'pawn':
    case 'ground':
      return 1.35;
    case 'rook':
    case 'siege':
      return 1.85;
    case 'bishop':
    case 'air':
      return 1.55;
    case 'knight':
      return 1.75;
    case 'queen':
      return 2.35;
  }
}

function tintObject(root: Object3D, side: EscortSide): void {
  const palette = sidePalette[side];
  root.traverse((node: any) => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    node.material = materials.map((mat: any) => {
      const clone = mat.clone ? mat.clone() : mat;
      if ('color' in clone) clone.color?.setHex?.(palette.base);
      if ('emissive' in clone) clone.emissive?.setHex?.(palette.emissive);
      if ('emissiveIntensity' in clone) clone.emissiveIntensity = Math.max(clone.emissiveIntensity ?? 0, side === 'ally' ? 0.28 : 0.4);
      if ('metalness' in clone) clone.metalness = Math.max(clone.metalness ?? 0, 0.2);
      return clone;
    });
  });
}

function addGroundRing(root: Object3D, side: EscortSide, key: PieceType | EnemyKind): void {
  const palette = sidePalette[side];
  const ring = new Mesh(
    new RingGeometry(key === 'queen' ? 0.85 : 0.6, key === 'queen' ? 1.35 : 0.95, 20),
    new MeshBasicMaterial({ color: palette.accent, transparent: true, opacity: side === 'ally' ? 0.6 : 0.35 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.95;
  root.add(ring);
}

function addMechDetails(root: Object3D, side: EscortSide): void {
  const palette = sidePalette[side];
  const armMat = new MeshLambertMaterial({ color: palette.accent, emissive: palette.emissive, emissiveIntensity: 0.35 });
  const limbGeo = new BoxGeometry(0.14, 0.95, 0.14);
  const armL = new Mesh(limbGeo, armMat);
  const armR = new Mesh(limbGeo, armMat);
  armL.position.set(-0.42, 0.1, 0);
  armR.position.set(0.42, 0.1, 0);
  const legL = new Mesh(new BoxGeometry(0.16, 0.95, 0.16), armMat);
  const legR = new Mesh(new BoxGeometry(0.16, 0.95, 0.16), armMat);
  legL.position.set(-0.18, -0.92, 0);
  legR.position.set(0.18, -0.92, 0);
  const head = new Mesh(new CylinderGeometry(0.18, 0.26, 0.32, 8), new MeshBasicMaterial({ color: palette.accent }));
  head.position.set(0, 0.9, 0);
  root.add(armL, armR, legL, legR, head);
}

function addAimMarker(root: Object3D, side: EscortSide, key: PieceType | EnemyKind): void {
  if (root.getObjectByName('escort-aim-marker')) return;
  const palette = sidePalette[side];
  const marker = new Group();
  marker.name = 'escort-aim-marker';
  const stem = new Mesh(
    new BoxGeometry(key === 'rook' || key === 'queen' ? 1.5 : 1.1, 0.1, 0.12),
    new MeshBasicMaterial({ color: palette.accent, transparent: true, opacity: 0.92 })
  );
  stem.position.set(0.55, 0.3, 0);
  const tip = new Mesh(
    new CylinderGeometry(0.02, 0.16, 0.34, 6),
    new MeshBasicMaterial({ color: palette.accent, transparent: true, opacity: 0.92 })
  );
  tip.rotation.z = -Math.PI / 2;
  tip.position.set(1.16, 0.3, 0);
  marker.add(stem, tip);
  root.add(marker);
}
