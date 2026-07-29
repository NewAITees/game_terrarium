import * as THREE from 'three';
import {
  getDroneVisualProfile,
  type BastionDrone,
  type BastionProjectile,
  type DroneBastionState,
  type DroneKind,
} from './drone_bastion_core.js';

const COLORS: Record<DroneKind, number> = {
  pawn: 0x56f0d1,
  rook: 0x6dbfe9,
  bishop: 0xa7bfff,
  knight: 0xff79c9,
  queen: 0xdc8cff,
};

export class DroneBastionScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 1, 2400);
  private readonly droneMeshes = new Map<number, THREE.Group>();
  private readonly enemyMeshes = new Map<number, THREE.Group>();
  private readonly projectileMeshes = new Map<number, THREE.Group>();
  private readonly damageSprites = new Map<number, THREE.Sprite>();
  private readonly wallMeshes = new Map<number, THREE.Mesh>();
  private readonly transientEffects: THREE.Object3D[] = [];
  private readonly cameraPosition = new THREE.Vector3();
  private readonly cameraTarget = new THREE.Vector3();
  private rangeFill: THREE.Mesh | null = null;
  private rangeLine: THREE.LineLoop | null = null;
  private rangeInnerLine: THREE.LineLoop | null = null;
  private rangeDroneId = -1;
  private tower: THREE.Group;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.scene.background = new THREE.Color(0x020610);
    this.scene.fog = new THREE.FogExp2(0x020610, 0.00135);

    const ambient = new THREE.HemisphereLight(0x7adfff, 0x11131a, 1.35);
    this.scene.add(ambient);
    const key = new THREE.DirectionalLight(0xdaf8ff, 1.85);
    key.position.set(-320, 520, 260);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -700;
    key.shadow.camera.right = 700;
    key.shadow.camera.top = 500;
    key.shadow.camera.bottom = -500;
    this.scene.add(key);

    this.scene.add(createGround());
    this.tower = createKingTower();
    this.scene.add(this.tower);
    addPerimeterLights(this.scene);
    this.camera.position.set(0, 220, 320);
  }

  render(state: DroneBastionState): void {
    this.resize();
    this.syncTower(state);
    this.syncWalls(state);
    this.syncDrones(state);
    this.syncEnemies(state);
    this.syncProjectiles(state);
    this.syncEffects(state);
    this.syncDamageNumbers(state);
    this.syncRange(state);
    this.updateCamera(state);
    this.renderer.render(this.scene, this.camera);
  }

  private syncTower(state: DroneBastionState): void {
    this.tower.position.set(worldX(state.tower.x, state), 0, worldZ(state.tower.y, state));
    const core = this.tower.getObjectByName('core') as THREE.Mesh | undefined;
    if (core?.material instanceof THREE.MeshStandardMaterial) {
      const ratio = state.tower.hp / state.tower.maxHp;
      core.material.emissive.setHex(ratio < 0.3 ? 0xff173d : ratio < 0.6 ? 0xff9d32 : 0x35ddff);
      core.material.emissiveIntensity = 1.2 + Math.sin(state.elapsed * 3) * 0.25;
    }
  }

  private syncWalls(state: DroneBastionState): void {
    const active = new Set<number>();
    for (const wall of state.walls) {
      active.add(wall.id);
      let mesh = this.wallMeshes.get(wall.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(wall.width, 16, wall.height),
          new THREE.MeshStandardMaterial({ color: 0x27465d, metalness: 0.78, roughness: 0.38 }),
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.wallMeshes.set(wall.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(worldX(wall.x, state), 8, worldZ(wall.y, state));
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.color.setHex(wall.hp <= 0 ? 0x251820 : wall.hp / wall.maxHp < 0.35 ? 0x87373c : 0x27465d);
      mesh.scale.y = wall.hp <= 0 ? 0.18 : 1;
    }
    removeMissing(this.wallMeshes, active, this.scene);
  }

  private syncDrones(state: DroneBastionState): void {
    const active = new Set<number>();
    for (const drone of state.drones) {
      active.add(drone.id);
      let mesh = this.droneMeshes.get(drone.id);
      if (!mesh) {
        mesh = createDroneModel(drone.kind);
        this.droneMeshes.set(drone.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(worldX(drone.x, state), droneHeight(drone), worldZ(drone.y, state));
      mesh.rotation.y = -drone.angle;
      mesh.visible = drone.mode !== 'disabled';
      const hp = mesh.getObjectByName('hp') as THREE.Mesh | undefined;
      if (hp) {
        hp.scale.x = Math.max(0.01, drone.hp / drone.maxHp);
        const material = hp.material as THREE.MeshBasicMaterial;
        material.color.setHex(drone.hp / drone.maxHp < 0.3 ? 0xff385f : 0x62ff9b);
      }
      const rotor = mesh.getObjectByName('rotor');
      if (rotor) rotor.rotation.y = state.elapsed * (drone.kind === 'knight' ? 15 : 11);
      const selected = state.drones[state.selectedDrone]?.id === drone.id;
      const beacon = mesh.getObjectByName('beacon') as THREE.Mesh | undefined;
      if (beacon?.material instanceof THREE.MeshBasicMaterial) {
        beacon.material.color.setHex(selected ? 0xffd166 : drone.mode === 'turret' ? 0x65ff9e : COLORS[drone.kind]);
      }
    }
    removeMissing(this.droneMeshes, active, this.scene);
  }

  private syncEnemies(state: DroneBastionState): void {
    const active = new Set<number>();
    for (const enemy of state.enemies) {
      active.add(enemy.id);
      let mesh = this.enemyMeshes.get(enemy.id);
      if (!mesh) {
        mesh = createEnemyModel(enemy.kind);
        this.enemyMeshes.set(enemy.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(worldX(enemy.x, state), enemy.kind === 'brute' ? 11 : 7, worldZ(enemy.y, state));
      mesh.rotation.y = -Math.atan2(enemy.vy, enemy.vx);
      const hp = mesh.getObjectByName('hp') as THREE.Mesh;
      hp.scale.x = Math.max(0.01, enemy.hp / enemy.maxHp);
    }
    removeMissing(this.enemyMeshes, active, this.scene);
  }

  private syncProjectiles(state: DroneBastionState): void {
    const active = new Set<number>();
    for (const projectile of state.projectiles) {
      active.add(projectile.id);
      let mesh = this.projectileMeshes.get(projectile.id);
      if (!mesh) {
        mesh = createProjectileModel(projectile);
        this.projectileMeshes.set(projectile.id, mesh);
        this.scene.add(mesh);
      }
      const progress = 1 - projectile.life / projectile.maxLife;
      const height = projectile.kind === 'mortar'
        ? 14 + Math.sin(progress * Math.PI) * 105
        : projectile.kind === 'missile' ? 18 : 12;
      mesh.position.set(worldX(projectile.x, state), height, worldZ(projectile.y, state));
      mesh.rotation.y = -Math.atan2(projectile.vy, projectile.vx);
      if (projectile.kind === 'mortar') {
        const horizontalSpeed = Math.max(1, Math.hypot(projectile.vx, projectile.vy));
        const verticalSpeed = 105 * Math.PI * Math.cos(progress * Math.PI) / projectile.maxLife;
        mesh.rotation.z = Math.atan2(verticalSpeed, horizontalSpeed);
      }
    }
    removeMissing(this.projectileMeshes, active, this.scene);
  }

  private syncEffects(state: DroneBastionState): void {
    for (const object of this.transientEffects) {
      this.scene.remove(object);
      disposeObject(object);
    }
    this.transientEffects.length = 0;
    for (const effect of state.effects) {
      const alpha = effect.life / effect.maxLife;
      const visual = effect.kind === 'arc'
        ? createArcEffect(effect.radius, effect.angle, alpha)
        : createMortarExplosion(effect.radius, alpha);
      visual.position.set(worldX(effect.x, state), 2.2, worldZ(effect.y, state));
      this.transientEffects.push(visual);
      this.scene.add(visual);
    }
  }

  private syncDamageNumbers(state: DroneBastionState): void {
    const active = new Set<number>();
    for (const number of state.damageNumbers) {
      active.add(number.id);
      let sprite = this.damageSprites.get(number.id);
      if (!sprite) {
        sprite = createDamageSprite(number.amount, number.target);
        this.damageSprites.set(number.id, sprite);
        this.scene.add(sprite);
      }
      const progress = 1 - number.life / number.maxLife;
      sprite.position.set(worldX(number.x, state), 30 + progress * 34, worldZ(number.y, state));
      const material = sprite.material as THREE.SpriteMaterial;
      material.opacity = Math.min(1, number.life * 3);
      const scale = 1 + Math.sin(Math.min(1, progress * 3) * Math.PI) * 0.18;
      sprite.scale.set(38 * scale, 19 * scale, 1);
    }
    removeMissing(this.damageSprites, active, this.scene);
  }

  private syncRange(state: DroneBastionState): void {
    const drone = state.drones[state.selectedDrone];
    if (!drone || drone.mode === 'disabled') {
      this.clearRange();
      return;
    }
    const profile = getDroneVisualProfile(drone.kind);
    const arc = profile.weapon === 'arc' ? Math.PI / 2 : Math.PI * 2;
    if (this.rangeDroneId !== drone.id) {
      this.clearRange();
      const fillGeometry = arc < Math.PI * 2
        ? sectorGeometry(profile.range, arc)
        : profile.minRange > 0
          ? new THREE.RingGeometry(profile.minRange, profile.range, 96)
          : new THREE.CircleGeometry(profile.range, 96);
      this.rangeFill = new THREE.Mesh(fillGeometry, new THREE.MeshBasicMaterial({
        color: COLORS[drone.kind],
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      this.rangeFill.rotation.x = -Math.PI / 2;
      this.scene.add(this.rangeFill);

      const points: THREE.Vector3[] = [];
      const start = arc < Math.PI * 2 ? -arc / 2 : 0;
      const segments = arc < Math.PI * 2 ? 40 : 96;
      if (arc < Math.PI * 2) points.push(new THREE.Vector3());
      for (let index = 0; index <= segments; index += 1) {
        const angle = start + arc * index / segments;
        points.push(new THREE.Vector3(Math.cos(angle) * profile.range, 0, Math.sin(angle) * profile.range));
      }
      if (arc < Math.PI * 2) points.push(new THREE.Vector3());
      this.rangeLine = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: COLORS[drone.kind], transparent: true, opacity: 1 }),
      );
      this.scene.add(this.rangeLine);
      if (profile.minRange > 0) {
        this.rangeInnerLine = new THREE.LineLoop(
          circleLineGeometry(profile.minRange, 96),
          new THREE.LineBasicMaterial({ color: 0xff8c42, transparent: true, opacity: 0.95 }),
        );
        this.scene.add(this.rangeInnerLine);
      }
      this.rangeDroneId = drone.id;
    }
    if (!this.rangeFill || !this.rangeLine) return;
    this.rangeFill.rotation.z = arc < Math.PI * 2 ? -drone.angle : 0;
    this.rangeLine.rotation.y = arc < Math.PI * 2 ? -drone.angle : 0;
    this.rangeFill.position.set(worldX(drone.x, state), 0.8, worldZ(drone.y, state));
    this.rangeLine.position.copy(this.rangeFill.position);
    this.rangeInnerLine?.position.copy(this.rangeFill.position);
  }

  private updateCamera(state: DroneBastionState): void {
    const drone = state.drones[state.selectedDrone] ?? state.drones[0];
    if (!drone) return;
    const forwardX = Math.cos(drone.angle);
    const forwardZ = Math.sin(drone.angle);
    const sideX = -forwardZ;
    const sideZ = forwardX;
    const x = worldX(drone.x, state);
    const z = worldZ(drone.y, state);
    const desiredPosition = new THREE.Vector3(
      x - forwardX * 235 + sideX * 145,
      175,
      z - forwardZ * 235 + sideZ * 145,
    );
    const desiredTarget = new THREE.Vector3(x + forwardX * 72, 14, z + forwardZ * 72);
    if (this.cameraPosition.lengthSq() < 1) {
      this.cameraPosition.copy(desiredPosition);
      this.cameraTarget.copy(desiredTarget);
    } else {
      const smoothing = 0.075;
      this.cameraPosition.lerp(desiredPosition, smoothing);
      this.cameraTarget.lerp(desiredTarget, smoothing);
    }
    this.camera.position.copy(this.cameraPosition);
    this.camera.lookAt(this.cameraTarget);
  }

  private clearRange(): void {
    if (this.rangeFill) {
      this.scene.remove(this.rangeFill);
      disposeObject(this.rangeFill);
    }
    if (this.rangeLine) {
      this.scene.remove(this.rangeLine);
      disposeObject(this.rangeLine);
    }
    if (this.rangeInnerLine) {
      this.scene.remove(this.rangeInnerLine);
      disposeObject(this.rangeInnerLine);
    }
    this.rangeFill = null;
    this.rangeLine = null;
    this.rangeInnerLine = null;
    this.rangeDroneId = -1;
  }

  private resize(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const ratio = Math.min(2, devicePixelRatio || 1);
    if (this.canvas.width !== Math.floor(width * ratio) || this.canvas.height !== Math.floor(height * ratio)) {
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / Math.max(1, height);
      this.camera.updateProjectionMatrix();
    }
  }
}

function createGround(): THREE.Group {
  const group = new THREE.Group();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1200, 760),
    new THREE.MeshStandardMaterial({ color: 0x07121d, metalness: 0.38, roughness: 0.72 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  const majorGrid = new THREE.GridHelper(1200, 30, 0x37dfff, 0x176483);
  majorGrid.position.y = 0.5;
  const majorMaterial = majorGrid.material as THREE.LineBasicMaterial;
  majorMaterial.transparent = true;
  majorMaterial.opacity = 0.68;
  majorMaterial.blending = THREE.AdditiveBlending;
  group.add(majorGrid);
  const fineGrid = new THREE.GridHelper(1200, 60, 0x174a62, 0x0c3146);
  fineGrid.position.y = 0.42;
  const fineMaterial = fineGrid.material as THREE.LineBasicMaterial;
  fineMaterial.transparent = true;
  fineMaterial.opacity = 0.5;
  group.add(fineGrid);
  const board = new THREE.Mesh(
    new THREE.RingGeometry(118, 134, 8),
    new THREE.MeshBasicMaterial({ color: 0x42dfff, transparent: true, opacity: 0.15, side: THREE.DoubleSide }),
  );
  board.rotation.x = -Math.PI / 2;
  board.position.y = 0.6;
  group.add(board);
  return group;
}

function createKingTower(): THREE.Group {
  const group = new THREE.Group();
  const metal = standard(0x254b63, 0x16384d);
  const glow = new THREE.MeshStandardMaterial({
    color: 0x39788c,
    emissive: 0x35ddff,
    emissiveIntensity: 1.5,
    metalness: 0.2,
    roughness: 0.2,
  });
  addMesh(group, new THREE.CylinderGeometry(54, 62, 16, 8), metal, 8);
  addMesh(group, new THREE.CylinderGeometry(39, 48, 62, 8), metal, 45);
  const core = addMesh(group, new THREE.OctahedronGeometry(27), glow, 82);
  core.name = 'core';
  addMesh(group, new THREE.BoxGeometry(10, 48, 10), glow, 121);
  const cross = addMesh(group, new THREE.BoxGeometry(38, 10, 10), glow, 129);
  cross.castShadow = true;
  return group;
}

function createDroneModel(kind: DroneKind): THREE.Group {
  const group = new THREE.Group();
  const color = COLORS[kind];
  const metal = standard(color, color);
  const dark = standard(0x101a24, 0x000000);
  const beacon = addMesh(group, new THREE.SphereGeometry(3.2, 10, 8), basic(color), 14);
  beacon.name = 'beacon';

  if (kind === 'rook') {
    addMesh(group, new THREE.BoxGeometry(30, 10, 24), metal, 7);
    addMesh(group, new THREE.BoxGeometry(34, 6, 5), dark, 3, 0, -13);
    addMesh(group, new THREE.BoxGeometry(34, 6, 5), dark, 3, 0, 13);
    addMesh(group, new THREE.CylinderGeometry(10, 12, 12, 8), metal, 17);
    const barrel = addMesh(group, new THREE.CylinderGeometry(3, 4, 31, 10), dark, 27);
    barrel.rotation.z = Math.PI / 2;
    barrel.position.x = 14;
  } else if (kind === 'bishop') {
    addMesh(group, new THREE.CylinderGeometry(11, 15, 18, 8), metal, 10);
    addMesh(group, new THREE.ConeGeometry(11, 27, 8), metal, 31);
    const rail = addMesh(group, new THREE.BoxGeometry(35, 3, 4), basic(0xbfe7ff), 25);
    rail.position.x = 16;
  } else if (kind === 'queen') {
    addMesh(group, new THREE.BoxGeometry(32, 16, 28), metal, 10);
    addMesh(group, new THREE.CylinderGeometry(14, 18, 23, 8), metal, 28);
    for (let index = 0; index < 5; index += 1) {
      const crown = addMesh(group, new THREE.ConeGeometry(4, 15, 6), basic(color), 49);
      const angle = index / 5 * Math.PI * 2;
      crown.position.x = Math.cos(angle) * 11;
      crown.position.z = Math.sin(angle) * 11;
    }
  } else {
    addMesh(group, new THREE.CylinderGeometry(kind === 'knight' ? 13 : 10, 15, 8, 8), metal, 8);
    const nose = addMesh(group, new THREE.ConeGeometry(8, 23, 6), metal, 10);
    nose.rotation.z = -Math.PI / 2;
    nose.position.x = 14;
    if (kind === 'knight') {
      const head = addMesh(group, new THREE.BoxGeometry(13, 19, 10), metal, 22);
      head.rotation.z = -0.35;
      head.position.x = 4;
    }
    const rotor = new THREE.Group();
    rotor.name = 'rotor';
    rotor.position.y = 19;
    addMesh(rotor, new THREE.BoxGeometry(55, 1.4, 3), basic(color), 0);
    addMesh(rotor, new THREE.BoxGeometry(3, 1.4, 55), basic(color), 0);
    group.add(rotor);
  }
  const hpBack = addMesh(group, new THREE.BoxGeometry(32, 2.5, 2), basic(0x241722), 45);
  hpBack.name = 'hp_back';
  const hp = addMesh(group, new THREE.BoxGeometry(32, 2.5, 2.2), basic(0x62ff9b), 45.2);
  hp.name = 'hp';
  hp.geometry.translate(16, 0, 0);
  hp.position.x = -16;
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) object.castShadow = true;
  });
  return group;
}

function createArcEffect(radius: number, angle: number, alpha: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    sectorGeometry(radius, Math.PI / 2),
    additiveMaterial(0xdc8cff, alpha * 0.42),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = -angle;
  return mesh;
}

function createMortarExplosion(radius: number, alpha: number): THREE.Group {
  const group = new THREE.Group();
  const expansion = 1 - alpha;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(
      radius * (0.35 + expansion * 0.5),
      radius * (0.48 + expansion * 0.52),
      48,
    ),
    additiveMaterial(0xff7b28, alpha * 0.8),
  );
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);

  const fireball = new THREE.Mesh(
    new THREE.SphereGeometry(radius * (0.16 + expansion * 0.22), 18, 12),
    additiveMaterial(alpha > 0.55 ? 0xfff09a : 0xff5527, alpha * 0.7),
  );
  fireball.position.y = radius * (0.12 + expansion * 0.28);
  group.add(fireball);

  for (let index = 0; index < 7; index += 1) {
    const angle = index / 7 * Math.PI * 2;
    const spark = new THREE.Mesh(
      new THREE.BoxGeometry(3, 3, radius * 0.22),
      additiveMaterial(0xffb13b, alpha * 0.9),
    );
    spark.position.set(
      Math.cos(angle) * radius * expansion * 0.72,
      8 + Math.sin(index * 2.1) * 6 + expansion * 18,
      Math.sin(angle) * radius * expansion * 0.72,
    );
    spark.rotation.y = -angle;
    group.add(spark);
  }
  return group;
}

function additiveMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

function createDamageSprite(
  amount: number,
  target: 'enemy' | 'drone' | 'tower',
): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (context) {
    const color = target === 'enemy' ? '#fff36e' : target === 'tower' ? '#ff405f' : '#ff9b57';
    context.font = '900 58px ui-monospace, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineWidth = 10;
    context.strokeStyle = 'rgba(2, 6, 16, .95)';
    const label = `${Math.max(1, Math.round(amount))}`;
    context.strokeText(label, 96, 48);
    context.fillStyle = color;
    context.fillText(label, 96, 48);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    toneMapped: false,
  }));
  sprite.renderOrder = 20;
  return sprite;
}

function createEnemyModel(kind: 'swarm' | 'brute'): THREE.Group {
  const group = new THREE.Group();
  const color = kind === 'brute' ? 0xff713f : 0xff345f;
  const body = addMesh(
    group,
    kind === 'brute' ? new THREE.DodecahedronGeometry(14) : new THREE.OctahedronGeometry(8),
    standard(color, color),
    0,
  );
  body.castShadow = true;
  const track = addMesh(group, new THREE.BoxGeometry(26, 2, 3), basic(0x30131c), 22);
  const hp = addMesh(group, new THREE.BoxGeometry(26, 2.4, 2), basic(color), 22.1);
  hp.name = 'hp';
  hp.geometry.translate(13, 0, 0);
  return group;
}

function createProjectileModel(projectile: BastionProjectile): THREE.Group {
  const group = new THREE.Group();
  const color = projectile.kind === 'missile' ? 0x72f4ff
    : projectile.kind === 'mortar' ? 0xffa63d
      : projectile.kind === 'pierce' ? 0xbb8cff : 0xff70c5;
  if (projectile.kind === 'missile') {
    const body = addMesh(group, new THREE.CylinderGeometry(2.2, 2.2, 15, 8), standard(0xd7f8ff, color), 0);
    body.rotation.z = Math.PI / 2;
    const nose = addMesh(group, new THREE.ConeGeometry(2.3, 6, 8), basic(color), 0);
    nose.rotation.z = -Math.PI / 2;
    nose.position.x = 10;
    const flame = addMesh(group, new THREE.ConeGeometry(3, 14, 8), basic(0x38dfff), 0);
    flame.rotation.z = Math.PI / 2;
    flame.position.x = -13;
  } else if (projectile.kind === 'mortar') {
    const shell = addMesh(
      group,
      new THREE.CylinderGeometry(4.2, 5.2, 17, 10),
      standard(0x303b46, color),
      0,
    );
    shell.rotation.z = Math.PI / 2;
    const nose = addMesh(group, new THREE.ConeGeometry(4.3, 8, 10), basic(0xffb34c), 0);
    nose.rotation.z = -Math.PI / 2;
    nose.position.x = 12;
    const tail = addMesh(group, new THREE.CylinderGeometry(5.4, 5.4, 3, 10), basic(0x71818c), 0);
    tail.rotation.z = Math.PI / 2;
    tail.position.x = -10;
  } else {
    const bolt = addMesh(group, new THREE.BoxGeometry(projectile.kind === 'pierce' ? 28 : 13, 3, 3), basic(color), 0);
    bolt.rotation.y = 0;
  }
  return group;
}

function sectorGeometry(radius: number, arc: number): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  const segments = 48;
  for (let index = 0; index <= segments; index += 1) {
    const angle = -arc / 2 + arc * index / segments;
    shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function circleLineGeometry(radius: number, segments: number): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = index / segments * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
  }
  return new THREE.BufferGeometry().setFromPoints(points);
}

function addPerimeterLights(scene: THREE.Scene): void {
  for (let index = 0; index < 16; index += 1) {
    const angle = index / 16 * Math.PI * 2;
    const light = new THREE.Mesh(
      new THREE.BoxGeometry(4, 2, 18),
      new THREE.MeshBasicMaterial({ color: index % 2 ? 0x1f6f91 : 0x164358 }),
    );
    light.position.set(Math.cos(angle) * 520, 1, Math.sin(angle) * 330);
    light.rotation.y = -angle;
    scene.add(light);
  }
}

function addMesh(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  y: number,
  x = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

function standard(color: number, emissive: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: 0.22,
    metalness: 0.72,
    roughness: 0.32,
  });
}

function basic(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, toneMapped: false });
}

function droneHeight(drone: BastionDrone): number {
  const chassis = getDroneVisualProfile(drone.kind).chassis;
  if (chassis === 'light_heli') return 25;
  if (chassis === 'heavy_heli') return 31;
  return 5;
}

function worldX(x: number, state: DroneBastionState): number {
  return x - state.width / 2;
}

function worldZ(y: number, state: DroneBastionState): number {
  return y - state.height / 2;
}

function removeMissing<T extends THREE.Object3D>(
  map: Map<number, T>,
  active: Set<number>,
  scene: THREE.Scene,
): void {
  for (const [id, object] of map) {
    if (active.has(id)) continue;
    scene.remove(object);
    disposeObject(object);
    map.delete(id);
  }
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Sprite) {
      child.material.map?.dispose();
      child.material.dispose();
      return;
    }
    if (!(child instanceof THREE.Mesh || child instanceof THREE.Line)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
}
