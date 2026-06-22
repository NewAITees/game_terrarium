import { BoxGeometry,Mesh,MeshLambertMaterial, } from 'three';
import { startAnimationFrameLoop } from '../../shared/browser-runtime.js';
import {
  CS,
  ENEMY_DMG,
  ENEMY_HP_BASE,
  ENEMY_SEP_FORCE,
  ENEMY_SEP_RADIUS,
  ENEMY_SPEED_BASE,
  COMMAND_MODE_LABEL,
  PIECE,
  SPAWN_SEC,
  START_GOLD,
  VIP_HP_MAX,
  VIP_SPEED,
  WAVE_BASE,
  bfsFlow,
  g2w,
  w2gi,
  type Effect,
  type Enemy,
  type GridPt,
  type CommandMode,
  type PieceType,
  type Unit,
} from './escort_td_core.js';
import { updateEscortTdHud, updateEscortTdVisibility } from './escort_td_scene.js';
import { createEscortEnemyVisual, createEscortUnitVisual } from './escort_td_visuals.js';
import { createEscortTdUnitCombat } from './escort_td_units.js';

const UNIT_MARCH: Record<PieceType, { speedMul: number; formationOffset: number }> = {
  pawn: { speedMul: 2.1, formationOffset: 10 },
  rook: { speedMul: 1.15, formationOffset: -10 },
  bishop: { speedMul: 1.75, formationOffset: 6 },
  knight: { speedMul: 2.45, formationOffset: 15 },
  queen: { speedMul: 1.3, formationOffset: -5 },
};

export function createEscortTdRuntime(context: any) {
  const state = { gold: START_GOLD, spawnTimer: SPAWN_SEC * 0.35, wave: 0, commandMode: 'balanced' as CommandMode };
  const effects: Effect[] = [];
  const enemies: Enemy[] = [];
  const units: Unit[] = [];
  const autoDeploy = buildAutoDeployPlan(context.city);
  let autoDeployTimer = 0.25;
  let autoDeployIndex = 0;
  const unitCombat = createEscortTdUnitCombat({
    effects,
    enemies,
    onGoldEarned: (amount: number) => {
      state.gold += amount;
    },
    onHudChanged: () => updateHud(),
    getCommandMode: () => state.commandMode,
    scene: context.scene,
  });

  const vipPath = buildVipPath(context.city.route);
  const marchPath = vipPath;
  const vipMesh = createVipMesh(context.scene, vipPath[0]);
  const vip = { hp: VIP_HP_MAX, pathIdx: 0, t: 0 };

  let enemyFlow = bfsFlow(context.city.g, context.city.width, context.city.height, context.city.start.x, context.city.start.y);
  let flowRefresh = 0;
  let over = false;
  let won = false;

  const spawnPoints = context.city.spawnPoints ?? buildSpawnCells(context.city);
  function placeUnit(gx: number, gy: number, type: PieceType): void {
    if (over || won) return;
    placeAutoUnit(gx, gy, type);
  }

  function restartIfFinished(): void {
    if (over || won) location.reload();
  }

  function updateHud(): void {
    updateEscortTdHud(context.hud, vip.hp, VIP_HP_MAX, state.gold, state.wave, COMMAND_MODE_LABEL[state.commandMode]);
    updateRosterHud();
  }

  function setCommandMode(mode: CommandMode): void {
    if (state.commandMode === mode) return;
    state.commandMode = mode;
    updateHud();
  }

  function updateRosterHud(): void {
    const allyCounts = countByType(units, ['pawn', 'rook', 'bishop', 'knight', 'queen']);
    const enemyCounts = countByKind(enemies, ['ground', 'siege', 'air']);
    setText('ally-pawn', allyCounts.pawn);
    setText('ally-rook', allyCounts.rook);
    setText('ally-bishop', allyCounts.bishop);
    setText('ally-knight', allyCounts.knight);
    setText('ally-queen', allyCounts.queen);
    setText('enemy-ground', enemyCounts.ground);
    setText('enemy-siege', enemyCounts.siege);
    setText('enemy-air', enemyCounts.air);
  }

  function autoDeployUnits(): void {
    if (over || won) return;
    const targetCount = 4 + state.wave * 2;
    if (units.length >= targetCount) return;
    const cells = autoDeploy.cells.length ? autoDeploy.cells : [{ x: context.city.start.x, y: context.city.start.y }];
    let guard = 0;
    while (state.gold >= 40 && units.length < targetCount && guard < cells.length * 2) {
      const type = pickAutoPieceType(state.wave, state.gold, units.length);
      const cell = cells[autoDeployIndex % cells.length];
      autoDeployIndex++;
      guard++;
      if (!placeAutoUnit(cell.x, cell.y, type)) continue;
      if (state.gold < 40) break;
    }
  }

  function placeAutoUnit(gx: number, gy: number, type: PieceType): boolean {
    const def = PIECE[type];
    if (state.gold < def.cost) return false;
    if (gx < 0 || gx >= context.city.width || gy < 0 || gy >= context.city.height || context.city.g[gy][gx] === 1) return false;
    if (units.some((unit) => unit.gx === gx && unit.gy === gy)) return false;
    state.gold -= def.cost;
    const p = g2w(gx, gy);
    const mesh = createEscortUnitVisual(type, 'ally');
    mesh.position.set(p.x, CS * 0.24, p.z);
    context.scene.add(mesh);
    const formation = UNIT_MARCH[type];
    units.push({
      type,
      gx,
      gy,
      wx: p.x,
      wz: p.z,
      mesh,
      fireTimer: 0,
      progress: projectPathCursor(marchPath, p.x, p.z),
      speedMul: formation.speedMul,
      formationOffset: formation.formationOffset,
      windupTimer: 0,
      pendingAttack: null,
      facing: 0,
    });
    updateHud();
    return true;
  }

  function tick(dt: number): void {
    if (over || won) return;
    advanceVip(dt);
    if (won) return;
    flowRefresh -= dt;
    if (flowRefresh <= 0) {
      flowRefresh = 1.4;
      refreshEnemyFlow();
    }
    autoDeployTimer -= dt;
    if (autoDeployTimer <= 0) {
      autoDeployTimer = 0.85;
      autoDeployUnits();
    }
    moveUnits(dt);
    moveEnemies(dt);
    separateEnemies(dt);
    cleanupDeadEnemies();
    unitCombat.runUnitAttacks(units, dt);
    unitCombat.updateEffects(dt);
    updateSpawns(dt);
    updateEscortTdVisibility(vipMesh, units, enemies, context.fogCells);
  }

  function start(clock: any): void {
    updateHud();
    startAnimationFrameLoop({
      clock,
      step: (dt) => {
        tick(dt);
        context.controls.update();
      },
      render: () => context.renderer.render(context.scene, context.camera),
    });
  }

  function advanceVip(dt: number): void {
    if (vip.pathIdx >= vipPath.length - 1) return;
    vip.t += (VIP_SPEED / CS) * dt;
    while (vip.t >= 1 && vip.pathIdx < vipPath.length - 1) {
      vip.t -= 1;
      vip.pathIdx++;
    }
    if (vip.pathIdx < vipPath.length - 1) {
      vipMesh.position.lerpVectors(vipPath[vip.pathIdx], vipPath[vip.pathIdx + 1], vip.t);
    } else {
      vipMesh.position.copy(vipPath[vipPath.length - 1]);
      won = true;
      showEndMessage('KING ESCAPED — MISSION COMPLETE\n[R] RESTART', '#4f4');
      return;
    }
    vipMesh.position.y = CS * 0.36;
  }

  function moveUnits(dt: number): void {
    if (!marchPath.length) return;
    const kingCursor = vip.pathIdx + vip.t;
    const last = marchPath.length - 1;
    for (const unit of units) {
      const targetCursor = clamp(kingCursor + unit.formationOffset, 0, last);
      const step = unit.speedMul * dt;
      const forwardBias = step * 0.7;
      unit.progress = Math.min(last, unit.progress + forwardBias);
      if (unit.progress < targetCursor - 1.5) unit.progress = Math.min(targetCursor, unit.progress + step * 0.95);
      else if (unit.progress > targetCursor + 1.5) unit.progress = Math.max(targetCursor, unit.progress - step * 0.35);

      const pos = samplePathPoint(marchPath, unit.progress);
      const next = samplePathPoint(marchPath, Math.min(last, unit.progress + 0.5));
      const dx = next.x - pos.x;
      const dz = next.z - pos.z;
      unit.wx = pos.x;
      unit.wz = pos.z;
      const grid = w2gi(pos.x, pos.z);
      unit.gx = grid.gx;
      unit.gy = grid.gy;
      unit.mesh.position.set(pos.x, CS * 0.24 + Math.sin((unit.progress + unit.formationOffset) * 0.35) * 0.12, pos.z);
      if (Math.hypot(dx, dz) > 0.0001) {
        const facing = Math.atan2(dz, dx);
        unit.facing = facing;
        unit.mesh.rotation.y = facing;
      }
    }
  }

  function refreshEnemyFlow(): void {
    const { gx, gy } = w2gi(vipMesh.position.x, vipMesh.position.z);
    enemyFlow = bfsFlow(context.city.g, context.city.width, context.city.height, clamp(gx, 0, context.city.width - 1), clamp(gy, 0, context.city.height - 1));
  }

  function moveEnemies(dt: number): void {
    const hitR2 = (CS * 0.5) ** 2;
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      if (enemy.kind === 'air') {
        moveEnemyToward(enemy, vipMesh.position.x, vipMesh.position.z, dt, 1.12);
      } else {
        const { gx, gy } = w2gi(enemy.x, enemy.z);
        if (gx >= 0 && gx < context.city.width && gy >= 0 && gy < context.city.height) {
          const fi = enemyFlow[gy * context.city.width + gx];
          if (fi >= 0) {
            enemy.x += context.d4[fi][0] * enemy.speed * dt;
            enemy.z += context.d4[fi][1] * enemy.speed * dt;
          }
        }
      }
      enemy.bobPhase += dt;
      enemy.mesh.position.set(enemy.x, enemy.kind === 'air' ? CS * 1.2 + Math.sin(enemy.bobPhase * 6) * 0.4 : CS * 0.18, enemy.z);
      if (enemy.hitFlash > 0) {
        enemy.hitFlash -= dt;
        const t = Math.max(0, enemy.hitFlash / 0.12);
        flashObject(enemy.mesh, t > 0 ? 0xffffff : 0x660000, t * 2.5 + (t === 0 ? 0.4 : 0));
      }

      const dx = enemy.x - vipMesh.position.x;
      const dz = enemy.z - vipMesh.position.z;
      if (dx * dx + dz * dz < hitR2) {
        vip.hp -= ENEMY_DMG;
        enemy.dead = true;
        if (vip.hp <= 0) {
          over = true;
          showEndMessage('KING CAPTURED — MISSION FAILED\n[R] RESTART', '#f44');
        }
        updateHud();
      }
    }
  }

  function separateEnemies(dt: number): void {
    const sepR2 = ENEMY_SEP_RADIUS * ENEMY_SEP_RADIUS;
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i];
      if (a.dead) continue;
      for (let j = i + 1; j < enemies.length; j++) {
        const b = enemies[j];
        if (b.dead) continue;
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < sepR2 && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const f = ((ENEMY_SEP_RADIUS - d) / d) * ENEMY_SEP_FORCE * dt;
          a.x += dx * f;
          a.z += dz * f;
          b.x -= dx * f;
          b.z -= dz * f;
        }
      }
    }
  }

  function cleanupDeadEnemies(): void {
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (!enemies[i].dead) continue;
      context.scene.remove(enemies[i].mesh);
      disposeObject3D(enemies[i].mesh);
      enemies.splice(i, 1);
    }
  }

  function updateSpawns(dt: number): void {
    state.spawnTimer -= dt;
    if (state.spawnTimer > 0) return;
    state.spawnTimer = SPAWN_SEC;
    state.wave++;
    spawnWave(state.wave, spawnPoints);
    updateHud();
  }

  function spawnWave(wave: number, points: { ground: GridPt[]; air: GridPt[]; siege: GridPt[] }): void {
    const count = WAVE_BASE + wave * 4;
    const hp = ENEMY_HP_BASE * (1 + wave * 0.18);
    const speed = ENEMY_SPEED_BASE * (1 + wave * 0.05);
    for (let i = 0; i < count; i++) {
      const kind = pickEnemyKind();
      const pool = points[kind];
      const c = pool[(Math.random() * Math.max(1, pool.length)) | 0] ?? context.city.start;
      const p = g2w(c.x, c.y);
      const jx = (Math.random() - 0.5) * CS * (kind === 'air' ? 2.5 : 0.3);
      const jz = (Math.random() - 0.5) * CS * (kind === 'air' ? 2.5 : 0.3);
      const mesh = createEscortEnemyVisual(kind);
      mesh.position.set(p.x + jx, kind === 'air' ? CS * 1.2 : CS * 0.18, p.z + jz);
      context.scene.add(mesh);
      enemies.push({
        x: p.x + jx,
        z: p.z + jz,
        hp: hp * (kind === 'siege' ? 1.35 : kind === 'air' ? 0.85 : 1),
        speed: speed * (kind === 'air' ? 1.18 : kind === 'siege' ? 0.84 : 1),
        mesh,
        dead: false,
        hitFlash: 0,
        kind,
        bobPhase: Math.random() * Math.PI * 2,
      });
    }
  }

  function showEndMessage(text: string, color: string): void {
    context.hud.msg.textContent = text;
    context.hud.msg.style.color = color;
    context.hud.msg.style.whiteSpace = 'pre';
    context.hud.msg.style.display = 'block';
  }

  return {
    placeUnit,
    setCommandMode,
    getCommandMode: () => state.commandMode,
    restartIfFinished,
    start,
  };
}

function buildVipPath(route: GridPt[]): any[] {
  const path: any[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    const a = g2w(route[i].x, route[i].y);
    const b = g2w(route[i + 1].x, route[i + 1].y);
    const stepCount = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.z - a.z)) / (CS * 0.35)));
    for (let s = 0; s < stepCount; s++) {
      const t = s / stepCount;
      path.push(a.clone().lerp(b, t));
    }
  }
  path.push(g2w(route[route.length - 1].x, route[route.length - 1].y));
  return path;
}

function samplePathPoint(path: any[], cursor: number): { x: number; z: number } {
  if (!path.length) return { x: 0, z: 0 };
  const last = path.length - 1;
  const idx = clamp(cursor, 0, last);
  const i0 = Math.floor(idx);
  const i1 = Math.min(last, i0 + 1);
  const t = idx - i0;
  const a = path[i0];
  const b = path[i1];
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function projectPathCursor(path: any[], wx: number, wz: number): number {
  if (!path.length) return 0;
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < path.length; i++) {
    const pt = path[i];
    const dx = pt.x - wx;
    const dz = pt.z - wz;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function createVipMesh(scene: any, startPoint: any) {
  const mesh = new Mesh(
    new BoxGeometry(CS * 0.54, CS * 0.72, CS * 0.54),
    new MeshLambertMaterial({ color: 0xffd700, emissive: 0xffaa00, emissiveIntensity: 0.35 })
  );
  mesh.castShadow = true;
  mesh.position.copy(startPoint);
  mesh.position.y = CS * 0.36;
  scene.add(mesh);
  return mesh;
}

function buildSpawnCells(city: any): GridPt[] {
  const cells: GridPt[] = [];
  for (let y = 0; y < city.height; y++) if (city.g[y][city.width - 1] === 0) cells.push({ x: city.width - 1, y });
  for (let x = 0; x < city.width; x++) if (city.g[0][x] === 0) cells.push({ x, y: 0 });
  for (let x = 0; x < city.width; x++) if (city.g[city.height - 1][x] === 0) cells.push({ x, y: city.height - 1 });
  return cells;
}

function buildAutoDeployPlan(city: any): { cells: GridPt[] } {
  const cells: GridPt[] = [];
  const seen = new Set<string>();
  const add = (pt?: GridPt | null) => {
    if (!pt) return;
    if (pt.x < 0 || pt.x >= city.width || pt.y < 0 || pt.y >= city.height) return;
    if (city.g[pt.y][pt.x] === 1) return;
    const key = `${pt.x}:${pt.y}`;
    if (seen.has(key)) return;
    seen.add(key);
    cells.push(pt);
  };

  add(city.start);
  add(city.end);
  for (const route of Array.isArray(city.roads) ? city.roads : []) {
    for (const pt of route?.points ?? []) add(pt);
  }
  for (const pt of Array.isArray(city.route) ? city.route : []) add(pt);
  for (let y = 0; y < city.height; y++) {
    for (let x = 0; x < city.width; x++) {
      if (city.g[y][x] === 0 && (x + y) % 3 === 0) add({ x, y });
    }
  }
  return { cells };
}

function countByType(items: Unit[], keys: PieceType[]): Record<PieceType, number> {
  const counts: Record<PieceType, number> = { pawn: 0, rook: 0, bishop: 0, knight: 0, queen: 0 };
  for (const item of items) counts[item.type] += 1;
  return counts;
}

function countByKind(items: Enemy[], keys: Array<'ground' | 'siege' | 'air'>): Record<'ground' | 'siege' | 'air', number> {
  const counts: Record<'ground' | 'siege' | 'air', number> = { ground: 0, siege: 0, air: 0 };
  for (const item of items) if (!item.dead) counts[item.kind] += 1;
  return counts;
}

function setText(id: string, value: number): void {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value);
}

function flashObject(root: any, color: number, intensity: number): void {
  root.traverse((node: any) => {
    if (!node.isMesh || !node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (material.emissive?.setHex) material.emissive.setHex(color);
      if ('emissiveIntensity' in material) material.emissiveIntensity = intensity;
    }
  });
}

function disposeObject3D(root: any): void {
  root.traverse((node: any) => {
    if (!node.isMesh) return;
    if (node.geometry) node.geometry.dispose?.();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) material?.dispose?.();
  });
}

function pickAutoPieceType(wave: number, gold: number, count: number): PieceType {
  if (wave < 2) return count % 3 === 0 || gold < 80 ? 'pawn' : 'rook';
  if (wave < 4) return count % 5 === 0 ? 'bishop' : count % 2 === 0 ? 'rook' : 'pawn';
  if (wave < 7) return count % 6 === 0 ? 'knight' : count % 4 === 0 ? 'bishop' : 'rook';
  if (gold >= 150 && count % 7 === 0) return 'queen';
  if (count % 5 === 0) return 'knight';
  return count % 2 === 0 ? 'bishop' : 'pawn';
}

function moveEnemyToward(enemy: Enemy, tx: number, tz: number, dt: number, speedMul: number): void {
  const dx = tx - enemy.x;
  const dz = tz - enemy.z;
  const len = Math.hypot(dx, dz) || 1;
  enemy.x += (dx / len) * enemy.speed * speedMul * dt;
  enemy.z += (dz / len) * enemy.speed * speedMul * dt;
}

function pickEnemyKind(): 'ground' | 'air' | 'siege' {
  const roll = Math.random();
  if (roll < 0.52) return 'ground';
  if (roll < 0.78) return 'siege';
  return 'air';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
