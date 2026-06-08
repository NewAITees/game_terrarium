import { BufferGeometry,DoubleSide,Line,LineBasicMaterial,Mesh,MeshBasicMaterial,RingGeometry,Vector3, } from 'three';
import { CS, GOLD_KILL, PIECE, type Effect, type Enemy, type Unit } from './escort_td_core.js';

export function createEscortTdUnitCombat(context: {
  effects: Effect[];
  enemies: Enemy[];
  onGoldEarned: (amount: number) => void;
  onHudChanged: () => void;
  scene: any;
}) {
  function runUnitAttacks(units: Unit[], dt: number): void {
    for (const unit of units) {
      unit.fireTimer -= dt;
      if (unit.fireTimer > 0) continue;
      const def = PIECE[unit.type];
      const r2 = def.range * def.range;
      let target: Enemy | null = null;
      let best = r2;
      for (const enemy of context.enemies) {
        if (enemy.dead) continue;
        const dx = enemy.x - unit.wx;
        const dz = enemy.z - unit.wz;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) {
          best = d2;
          target = enemy;
        }
      }
      if (!target) continue;
      unit.fireTimer = def.fireRate;
      spawnTracer(unit.wx, unit.wz, target.x, target.z, def.color);
      if (def.aoe > 0) {
        spawnAOERing(target.x, target.z, def.aoe, def.color);
        const aoe2 = def.aoe * def.aoe;
        for (const enemy of context.enemies) {
          if (enemy.dead) continue;
          const dx = enemy.x - target.x;
          const dz = enemy.z - target.z;
          if (dx * dx + dz * dz <= aoe2) applyEnemyDamage(enemy, def.dmg);
        }
      } else {
        applyEnemyDamage(target, def.dmg);
      }
      context.onHudChanged();
    }
  }

  function updateEffects(dt: number): void {
    for (let i = context.effects.length - 1; i >= 0; i--) {
      const effect = context.effects[i];
      effect.life -= dt;
      const t = effect.life / effect.maxLife;
      effect.mat.opacity = t * (effect.grow ? 0.55 : 1);
      if (effect.grow) effect.mesh.scale.setScalar(1 - t);
      if (effect.life <= 0) {
        context.scene.remove(effect.mesh);
        effect.mesh.geometry.dispose();
        effect.mat.dispose();
        context.effects.splice(i, 1);
      }
    }
  }

  function applyEnemyDamage(enemy: Enemy, dmg: number): void {
    enemy.hp -= dmg;
    enemy.hitFlash = 0.12;
    if (enemy.hp <= 0) {
      enemy.dead = true;
      context.onGoldEarned(GOLD_KILL);
    }
  }

  function spawnTracer(fx: number, fz: number, tx: number, tz: number, color: number): void {
    const pts = [new Vector3(fx, CS * 0.32, fz), new Vector3(tx, CS * 0.2, tz)];
    const mat = new LineBasicMaterial({ color, transparent: true, opacity: 1 });
    const mesh = new Line(new BufferGeometry().setFromPoints(pts), mat);
    context.scene.add(mesh);
    context.effects.push({ grow: false, life: 0.12, mat, maxLife: 0.12, mesh });
  }

  function spawnAOERing(tx: number, tz: number, radius: number, color: number): void {
    const mat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: DoubleSide });
    const mesh = new Mesh(new RingGeometry(radius * 0.85, radius, 32), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(tx, 0.25, tz);
    mesh.scale.setScalar(0.05);
    context.scene.add(mesh);
    context.effects.push({ grow: true, life: 0.4, mat, maxLife: 0.4, mesh });
  }

  return {
    runUnitAttacks,
    updateEffects,
  };
}
