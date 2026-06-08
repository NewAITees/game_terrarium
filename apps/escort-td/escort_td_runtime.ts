import * as THREE from 'three';
import { startAnimationFrameLoop } from '../../shared/browser-runtime.js';
import {
  CS,
  ENEMY_DMG,
  ENEMY_HP_BASE,
  ENEMY_SEP_FORCE,
  ENEMY_SEP_RADIUS,
  ENEMY_SPEED_BASE,
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
  type PieceType,
  type Unit,
} from './escort_td_core.js';
import { updateEscortTdHud, updateEscortTdVisibility } from './escort_td_scene.js';
import { createEscortTdUnitCombat } from './escort_td_units.js';

export function createEscortTdRuntime(context: any) {
  const state = { gold: START_GOLD, spawnTimer: SPAWN_SEC * 0.35, wave: 0 };
  const effects: Effect[] = [];
  const enemies: Enemy[] = [];
  const units: Unit[] = [];
  const unitCombat = createEscortTdUnitCombat({
    effects,
    enemies,
    onGoldEarned: (amount: number) => {
      state.gold += amount;
    },
    onHudChanged: () => updateHud(),
    scene: context.scene,
  });

  const vipFlow = bfsFlow(context.city.g, context.city.width, context.city.height, context.city.end.x, context.city.end.y);
  const vipPath = buildVipPath(vipFlow, context.city.start, context.city.end);
  const vipMesh = createVipMesh(context.scene, vipPath[0]);
  const vip = { hp: VIP_HP_MAX, pathIdx: 0, t: 0 };

  let enemyFlow = bfsFlow(context.city.g, context.city.width, context.city.height, context.city.start.x, context.city.start.y);
  let flowRefresh = 0;
  let over = false;
  let won = false;

  const spawnCells = buildSpawnCells(context.city);
  const enemyGeo = new THREE.BoxGeometry(CS * 0.36, CS * 0.36, CS * 0.36);
  const enemyMat = new THREE.MeshLambertMaterial({ color: 0xee2222, emissive: 0x660000, emissiveIntensity: 0.4 });

  function placeUnit(gx: number, gy: number, type: PieceType): void {
    const def = PIECE[type];
    if (over || won || state.gold < def.cost) return;
    if (gx < 0 || gx >= context.city.width || gy < 0 || gy >= context.city.height || context.city.g[gy][gx] === 1) return;
    if (units.some((unit) => unit.gx === gx && unit.gy === gy)) return;
    state.gold -= def.cost;
    const p = g2w(gx, gy);
    const mesh = new THREE.Mesh(
      def.makeGeo(),
      new THREE.MeshLambertMaterial({ color: def.color, emissive: def.emissive, emissiveIntensity: 0.35 })
    );
    mesh.castShadow = true;
    mesh.position.set(p.x, CS * 0.24, p.z);
    context.scene.add(mesh);
    units.push({ type, gx, gy, wx: p.x, wz: p.z, mesh, fireTimer: 0 });
    updateHud();
  }

  function restartIfFinished(): void {
    if (over || won) location.reload();
  }

  function updateHud(): void {
    updateEscortTdHud(context.hud, vip.hp, VIP_HP_MAX, state.gold, state.wave);
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

  function refreshEnemyFlow(): void {
    const { gx, gy } = w2gi(vipMesh.position.x, vipMesh.position.z);
    enemyFlow = bfsFlow(context.city.g, context.city.width, context.city.height, clamp(gx, 0, context.city.width - 1), clamp(gy, 0, context.city.height - 1));
  }

  function moveEnemies(dt: number): void {
    const hitR2 = (CS * 0.5) ** 2;
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      const { gx, gy } = w2gi(enemy.x, enemy.z);
      if (gx >= 0 && gx < context.city.width && gy >= 0 && gy < context.city.height) {
        const fi = enemyFlow[gy * context.city.width + gx];
        if (fi >= 0) {
          enemy.x += context.d4[fi][0] * enemy.speed * dt;
          enemy.z += context.d4[fi][1] * enemy.speed * dt;
        }
      }
      enemy.mesh.position.set(enemy.x, CS * 0.18, enemy.z);
      if (enemy.hitFlash > 0) {
        enemy.hitFlash -= dt;
        const t = Math.max(0, enemy.hitFlash / 0.12);
        enemy.mesh.material.emissive.setHex(t > 0 ? 0xffffff : 0x660000);
        enemy.mesh.material.emissiveIntensity = t * 2.5 + (t === 0 ? 0.4 : 0);
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
      enemies[i].mesh.material.dispose();
      enemies.splice(i, 1);
    }
  }

  function updateSpawns(dt: number): void {
    state.spawnTimer -= dt;
    if (state.spawnTimer > 0) return;
    state.spawnTimer = SPAWN_SEC;
    state.wave++;
    spawnWave(state.wave, enemyGeo, enemyMat, spawnCells);
    updateHud();
  }

  function spawnWave(wave: number, geo: any, mat: any, cells: GridPt[]): void {
    const count = WAVE_BASE + wave * 4;
    const hp = ENEMY_HP_BASE * (1 + wave * 0.18);
    const speed = ENEMY_SPEED_BASE * (1 + wave * 0.05);
    for (let i = 0; i < count; i++) {
      const c = cells[(Math.random() * cells.length) | 0];
      const p = g2w(c.x, c.y);
      const jx = (Math.random() - 0.5) * CS * 0.3;
      const jz = (Math.random() - 0.5) * CS * 0.3;
      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.castShadow = true;
      mesh.position.set(p.x + jx, CS * 0.18, p.z + jz);
      context.scene.add(mesh);
      enemies.push({ x: p.x + jx, z: p.z + jz, hp, speed, mesh, dead: false, hitFlash: 0 });
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
    restartIfFinished,
    start,
  };
}

function buildVipPath(flow: Int8Array, start: GridPt, end: GridPt): any[] {
  const path: any[] = [];
  let x = start.x;
  let y = start.y;
  for (let i = 0; i < 1024; i++) {
    path.push(g2w(x, y));
    if (x === end.x && y === end.y) break;
    const fi = flow[y * 21 + x];
    if (fi < 0) break;
    x += [[1, 0], [-1, 0], [0, 1], [0, -1]][fi][0];
    y += [[1, 0], [-1, 0], [0, 1], [0, -1]][fi][1];
  }
  return path;
}

function createVipMesh(scene: any, startPoint: any) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(CS * 0.54, CS * 0.72, CS * 0.54),
    new THREE.MeshLambertMaterial({ color: 0xffd700, emissive: 0xffaa00, emissiveIntensity: 0.35 })
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
