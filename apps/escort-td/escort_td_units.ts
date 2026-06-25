import { BufferGeometry,DoubleSide,Line,LineBasicMaterial,LineLoop,Mesh,MeshBasicMaterial,RingGeometry,Vector3, } from 'three';
import { CS, GOLD_KILL, PIECE, type CommandMode, type Effect, type Enemy, type PendingAttack, type Unit } from './escort_td_core.js';

export function createEscortTdUnitCombat(context: {
  effects: Effect[];
  enemies: Enemy[];
  onGoldEarned: (amount: number) => void;
  onHudChanged: () => void;
  getCommandMode: () => CommandMode;
  scene: any;
}) {
  function runUnitAttacks(units: Unit[], dt: number): void {
    for (const unit of units) {
      const def = PIECE[unit.type];

      if (unit.windupTimer > 0) {
        unit.windupTimer -= dt;
        updatePendingAttack(unit);
        if (unit.windupTimer > 0) continue;
        resolvePendingAttack(unit, def.dmg);
        unit.pendingAttack = null;
        unit.fireTimer = def.fireRate;
        continue;
      }

      unit.fireTimer -= dt;
      if (unit.fireTimer > 0) continue;

      let target: Enemy | null = null;
      let best = Number.POSITIVE_INFINITY;
      const range2 = def.range * def.range;
      for (const enemy of context.enemies) {
        if (enemy.dead) continue;
        const dx = enemy.x - unit.wx;
        const dz = enemy.z - unit.wz;
        const d2 = dx * dx + dz * dz;
        if (d2 > range2) continue;
        const score = scoreEnemy(enemy, d2, context.getCommandMode());
        if (score < best) {
          best = score;
          target = enemy;
        }
      }
      if (!target) continue;
      unit.aimFacing = Math.atan2(target.z - unit.wz, target.x - unit.wx);
      unit.pendingAttack = buildPendingAttack(unit, target, def.attackShape, def.aoe, def.color, def.attackWindup);
      unit.windupTimer = def.attackWindup;
      spawnTracer(unit.wx, unit.wz, target.x, target.z, def.color);
      spawnAttackPreview(unit, unit.pendingAttack, def.color);
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

  function resolvePendingAttack(unit: Unit, dmg: number): void {
    const attack = unit.pendingAttack;
    if (!attack) return;
    if (attack.shape === 'square') {
      const half = attack.radius;
      for (const enemy of context.enemies) {
        if (enemy.dead) continue;
        const dx = Math.abs(enemy.x - attack.x);
        const dz = Math.abs(enemy.z - attack.z);
        if (dx <= half && dz <= half) applyEnemyDamage(enemy, dmg);
      }
      return;
    }
    if (attack.shape === 'circle') {
      const r2 = attack.radius * attack.radius;
      for (const enemy of context.enemies) {
        if (enemy.dead) continue;
        const dx = enemy.x - attack.x;
        const dz = enemy.z - attack.z;
        if (dx * dx + dz * dz <= r2) applyEnemyDamage(enemy, dmg);
      }
      return;
    }

    const dir = { x: Math.cos(attack.facing), z: Math.sin(attack.facing) };
    const coneCos = Math.cos(Math.PI / 5.5);
    for (const enemy of context.enemies) {
      if (enemy.dead) continue;
      const dx = enemy.x - unit.wx;
      const dz = enemy.z - unit.wz;
      const dist = Math.hypot(dx, dz);
      if (dist > attack.radius) continue;
      const dot = (dx / Math.max(dist, 0.0001)) * dir.x + (dz / Math.max(dist, 0.0001)) * dir.z;
      if (dot >= coneCos) applyEnemyDamage(enemy, dmg);
    }
  }

  function buildPendingAttack(unit: Unit, target: Enemy, shape: PendingAttack['shape'], radius: number, color: number, windup: number): PendingAttack {
    return {
      x: target.x,
      z: target.z,
      shape,
      radius: Math.max(radius, shape === 'square' ? CS * 1.2 : CS * 0.5),
      color,
      remaining: windup,
      facing: unit.aimFacing,
    };
  }

  function updatePendingAttack(unit: Unit): void {
    if (!unit.pendingAttack) return;
    unit.pendingAttack.remaining = Math.max(0, unit.windupTimer);
  }

  function spawnTracer(fx: number, fz: number, tx: number, tz: number, color: number): void {
    const pts = [new Vector3(fx, CS * 0.32, fz), new Vector3(tx, CS * 0.2, tz)];
    const mat = new LineBasicMaterial({ color, transparent: true, opacity: 1 });
    const mesh = new Line(new BufferGeometry().setFromPoints(pts), mat);
    context.scene.add(mesh);
    context.effects.push({ grow: false, life: 0.12, mat, maxLife: 0.12, mesh });
  }

  function spawnAttackPreview(unit: Unit, attack: PendingAttack, color: number): void {
    if (attack.shape === 'circle') {
      const mat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.28, side: DoubleSide });
      const mesh = new Mesh(new RingGeometry(attack.radius * 0.82, attack.radius, 32), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(attack.x, 0.25, attack.z);
      mesh.scale.setScalar(0.1);
      context.scene.add(mesh);
      context.effects.push({ grow: true, life: Math.max(0.35, attack.remaining + 0.1), mat, maxLife: Math.max(0.35, attack.remaining + 0.1), mesh });
      return;
    }

    if (attack.shape === 'square') {
      const mesh = buildSquareIndicator(attack.x, attack.z, attack.radius * 2, color, Math.max(0.35, attack.remaining + 0.08));
      context.scene.add(mesh);
      return;
    }

    const mesh = buildFanIndicator(unit.wx, unit.wz, attack.facing, attack.radius, color, Math.max(0.22, attack.remaining + 0.06));
    context.scene.add(mesh);
  }

  function buildSquareIndicator(cx: number, cz: number, size: number, color: number, life: number): LineLoop {
    const points = [
      new Vector3(-size / 2, 0, -size / 2),
      new Vector3(size / 2, 0, -size / 2),
      new Vector3(size / 2, 0, size / 2),
      new Vector3(-size / 2, 0, size / 2),
      new Vector3(-size / 2, 0, -size / 2),
    ];
    const line = new LineLoop(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color, transparent: true, opacity: 0.95 }));
    line.position.set(cx, 0.26, cz);
    context.effects.push({ grow: false, life, mat: line.material, maxLife: life, mesh: line });
    return line;
  }

  function buildFanIndicator(cx: number, cz: number, facing: number, radius: number, color: number, life: number): LineLoop {
    const pts = [new Vector3(0, 0, 0)];
    const spread = Math.PI / 5.5;
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const ang = facing - spread + (spread * 2 * i) / steps;
      pts.push(new Vector3(Math.cos(ang) * radius, 0, Math.sin(ang) * radius));
    }
    const line = new LineLoop(new BufferGeometry().setFromPoints(pts), new LineBasicMaterial({ color, transparent: true, opacity: 0.82 }));
    line.position.set(cx, 0.24, cz);
    context.effects.push({ grow: false, life, mat: line.material, maxLife: life, mesh: line });
    return line;
  }

  function scoreEnemy(enemy: Enemy, dist2: number, mode: CommandMode): number {
    if (mode === 'balanced') return dist2;
    const priority: Record<'ground' | 'air' | 'siege', number> = {
      ground: mode === 'ground' ? 0 : mode === 'siege' ? 1 : 2,
      air: mode === 'air' ? 0 : mode === 'siege' ? 1 : 2,
      siege: mode === 'siege' ? 0 : mode === 'air' ? 1 : 2,
    };
    return priority[enemy.kind] * 1_000_000 + dist2;
  }

  return {
    runUnitAttacks,
    updateEffects,
  };
}
