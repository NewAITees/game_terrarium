import type {
  EscortTdAction,
  EscortTdCommandMode,
  EscortTdCountsSnapshot,
  EscortTdEnemyKind,
  EscortTdLaserEvent,
  EscortTdMetaProgress,
  EscortTdPieceType,
  EscortTdProjectileSnapshot,
  EscortTdRallyRole,
  EscortTdRunResult,
  EscortTdStateSnapshot,
} from '../shared/types/escort_td';
import { calculateEscortCoverage, calculateEscortResult, canEscortUnitAttackTarget, getEscortDamageMultiplier, getEscortMetaValues, getEscortReclaimGold, getEscortSpawnInterval, getEscortUnitPowerMultipliers, normalizeEscortMeta } from './escort_td_rules';
import {
  ADVANCE_COVERAGE_THRESHOLD, COMMAND_MODES, CS, D4, ENEMY_DMG, ENEMY_GUARD_DAMAGE_PER_SECOND,
  ENEMY_HP_BASE, ENEMY_SEP_FORCE, ENEMY_SEP_RADIUS, ENEMY_SPEED_BASE, GH, GOLD_KILL, GUARD_REFORM_SECONDS,
  GW, PAWN_VISION, PIECE, SIEGE_BARRICADE_DAMAGE_PER_SECOND, START_GOLD, UNIT_GUARD, VIP_HP_MAX, VIP_SPEED,
  VIP_VISION, WAVE_BASE,
} from './escort_td_config';
import type { Barricade, CityData, Enemy, FlyingProjectile, PendingAttack, SpawnPoints, Unit } from './escort_td_config';
import { bfsFlow, buildCity, buildDetourVipPath, buildVipPath, findGridPath, g2w, pathLength, w2gi } from './escort_td_city_gen';
import { blendAngle, buildInterceptPoint, clamp, guardHp, isGroundGuard, moveEnemyToward, pickAutoPieceType, pickEnemyKind, pickInterceptTarget, scoreEnemy } from './escort_td_combat_ai';

export class EscortTdRuntime {
  private readonly citySeed: number;
  private readonly meta: EscortTdMetaProgress;
  private readonly vipHpMax: number;
  private readonly unitLimit: number;
  private readonly maxTimeScale: 1 | 2 | 4;
  private readonly city: CityData;
  private vipPath: Array<{ x: number; z: number }>;
  private readonly spawnPoints: SpawnPoints;
  private readonly units: Unit[] = [];
  private readonly enemies: Enemy[] = [];
  private readonly barricades: Barricade[] = [];
  private readonly vip: { hp: number; pathIdx: number; t: number; x: number; z: number };
  private readonly state = {
    gold: START_GOLD,
    wave: 0,
    commandMode: 'balanced' as EscortTdCommandMode,
    timeScale: 1 as 0 | 1 | 2 | 4,
    rallyPoints: {
      left: { forward: 0.35, side: 1.35 },
      right: { forward: 0.35, side: -1.35 },
      rear: { forward: -1.45, side: 0 },
    },
    kingPaused: false,
    forceAdvance: false,
    over: false,
    won: false,
    kills: { ground: 0, air: 0, siege: 0 } as Record<EscortTdEnemyKind, number>,
    result: null as EscortTdRunResult | null,
  };
  private lastTickAt = Date.now();
  private flowRefresh = 0;
  private enemyFlow: Int8Array;
  private nextUnitId = 1;
  private nextEnemyId = 1;
  private nextBarricadeId = 1;
  private autoDeployTimer = 0.25;
  private nextSpawnProgress = 0.02;
  private readonly flyingProjectiles: FlyingProjectile[] = [];
  private readonly laserEvents: EscortTdLaserEvent[] = [];
  private nextProjectileId = 1;
  private routeChoice: { remainingSeconds: number; options: Map<'direct' | 'detour', Array<{ x: number; z: number }>> } | null = null;
  private routeChoiceShown = false;

  constructor(seed = (Math.random() * 0xffffff) | 0, meta: Partial<EscortTdMetaProgress> = {}) {
    this.meta = normalizeEscortMeta(meta);
    const metaValues = getEscortMetaValues(this.meta);
    this.vipHpMax = metaValues.kingHpMax;
    this.unitLimit = metaValues.unitLimit;
    this.maxTimeScale = this.meta.speedLevel >= 2 ? 4 : this.meta.speedLevel >= 1 ? 2 : 1;
    this.vip = { hp: this.vipHpMax, pathIdx: 0, t: 0, x: 0, z: 0 };
    this.state.gold = metaValues.startGold;
    this.citySeed = seed;
    this.city = buildCity(GW, GH, seed);
    this.vipPath = buildVipPath(this.city.route);
    const start = this.vipPath[0] ?? { x: 0, z: 0 };
    this.vip.x = start.x;
    this.vip.z = start.z;
    this.spawnPoints = this.city.spawnPoints;
    this.enemyFlow = bfsFlow(this.city.g, this.city.width, this.city.height, this.city.start.x, this.city.start.y);
  }

  tickToNow(): void {
    const now = Date.now();
    const dt = Math.min((now - this.lastTickAt) / 1000, 0.05) * this.state.timeScale;
    this.lastTickAt = now;
    if (dt > 0) this.tick(dt);
  }

  /**
   * Deterministic fast-forward for headless simulation/testing: advances game time by
   * `totalSeconds` in fixed `stepSeconds` increments, ignoring timeScale and wall-clock time.
   */
  advance(totalSeconds: number, stepSeconds = 0.05): void {
    let remaining = totalSeconds;
    while (remaining > 0 && !this.state.over && !this.state.won) {
      const dt = Math.min(stepSeconds, remaining);
      this.tick(dt);
      remaining -= dt;
    }
    this.lastTickAt = Date.now();
  }

  getSnapshot(): EscortTdStateSnapshot {
    this.tickToNow();
    const nextPoint = this.vipPath[Math.min(this.vip.pathIdx + 1, this.vipPath.length - 1)] ?? this.vip;
    return {
      page: 'escort_td',
      updatedAt: new Date().toISOString(),
      citySeed: this.citySeed,
      wave: this.state.wave,
      gold: this.state.gold,
      commandMode: this.state.commandMode,
      timeScale: this.state.timeScale,
      rallyPoints: this.state.rallyPoints,
      routeChoice: this.routeChoice ? {
        remainingSeconds: Math.ceil(this.routeChoice.remainingSeconds),
        options: Array.from(this.routeChoice.options, ([id, path]) => ({ id, label: id === 'direct' ? 'MAIN ROAD' : 'OUTER LOOP', distance: pathLength(path) })),
      } : null,
      meta: this.meta,
      progressPercent: this.progressPercent(),
      king: {
        x: this.vip.x,
        z: this.vip.z,
        hp: this.vip.hp,
        hpMax: this.vipHpMax,
        nextX: nextPoint.x,
        nextZ: nextPoint.z,
        paused: this.state.kingPaused,
        coveragePercent: this.coveragePercent(),
        advanceBlocked: !this.state.kingPaused && this.coveragePercent() < ADVANCE_COVERAGE_THRESHOLD,
        forcedAdvance: this.state.forceAdvance,
      },
      units: this.units.map((unit) => ({
        id: unit.id,
        type: unit.type,
        gx: unit.gx,
        gy: unit.gy,
        wx: unit.wx,
        wz: unit.wz,
        moveFacing: unit.moveFacing,
        aimFacing: unit.aimFacing,
        patrolRadius: unit.patrolRadius,
        deployed: unit.deployed,
        hp: unit.hp,
        hpMax: unit.hpMax,
        respawnTimer: unit.respawnTimer,
      })),
      barricades: this.barricades.map((barricade) => ({ ...barricade })),
      approachPaths: this.enemyApproachPaths(),
      enemies: this.enemies.filter((enemy) => !enemy.dead).map((enemy) => ({
        id: enemy.id,
        kind: enemy.kind,
        x: enemy.x,
        z: enemy.z,
        hp: enemy.hp,
        bobPhase: enemy.bobPhase,
        hitFlash: enemy.hitFlash,
      })),
      counts: this.counts(),
      projectiles: this.flyingProjectiles.map((p) => ({
        id: p.id, unitType: p.unitType,
        x: p.x, z: p.z,
        fromX: p.fromX, fromZ: p.fromZ,
        targetX: p.targetX, targetZ: p.targetZ,
        dirX: p.dirX, dirZ: p.dirZ,
        speed: p.speed,
      } satisfies EscortTdProjectileSnapshot)),
      laserEvents: this.laserEvents.splice(0),
      result: this.state.result,
      over: this.state.over,
      won: this.state.won,
    };
  }

  processAction(action: EscortTdAction): { ok: true } | { ok: false; error: string } {
    this.tickToNow();
    if (this.state.over || this.state.won) return { ok: false, error: 'match finished' };
    if (action.action === 'deploy') {
      const type = pickAutoPieceType(this.state.wave, this.state.gold, this.units.length);
      if (!this.spawnUnitNearKing(type)) return { ok: false, error: 'not enough gold' };
      return { ok: true };
    }
    if (action.action === 'toggle_pause') {
      this.state.kingPaused = !this.state.kingPaused;
      if (this.state.kingPaused) this.state.forceAdvance = false;
      return { ok: true };
    }
    if (action.action === 'toggle_force_advance') {
      this.state.forceAdvance = !this.state.forceAdvance;
      if (this.state.forceAdvance) this.state.kingPaused = false;
      return { ok: true };
    }
    if (action.action === 'set_speed') {
      if (action.speed > this.maxTimeScale) return { ok: false, error: 'speed upgrade required' };
      this.state.timeScale = action.speed;
      return { ok: true };
    }
    if (action.action === 'set_rally') {
      this.state.rallyPoints[action.role] = {
        forward: clamp(action.forward, -3, 3),
        side: clamp(action.side, -3, 3),
      };
      return { ok: true };
    }
    if (action.action === 'choose_route') return this.chooseRoute(action.route);
    if (action.action === 'set_command_mode') {
      if (!COMMAND_MODES.includes(action.mode)) return { ok: false, error: 'invalid mode' };
      this.state.commandMode = action.mode;
      return { ok: true };
    }
    if (action.action === 'place_unit') return this.placeUnit(action.gx, action.gy, action.type);
    if (action.action === 'place_barricade') return this.placeBarricade(action.gx, action.gy);
    if (action.action === 'reclaim_at') return this.reclaimAt(action.gx, action.gy);
    return { ok: false, error: 'unknown action' };
  }

  private tick(dt: number): void {
    if (this.state.over || this.state.won) return;
    this.advanceVip(dt);
    if (this.state.won) {
      this.finalizeRun('cleared');
      return;
    }
    this.flowRefresh -= dt;
    if (this.flowRefresh <= 0) {
      this.flowRefresh = 1.4;
      this.refreshEnemyFlow();
    }
    this.autoDeployTimer -= dt;
    if (this.autoDeployTimer <= 0) {
      this.autoDeployTimer = 0.85;
      this.autoDeployUnits();
    }
    this.moveUnits(dt);
    this.moveEnemies(dt);
    this.separateEnemies(dt);
    this.cleanupDeadEnemies();
    this.runUnitAttacks(dt);
    this.moveProjectiles(dt);
    this.updateSpawns();
  }

  private advanceVip(dt: number): void {
    if (this.routeChoice) {
      this.routeChoice.remainingSeconds -= dt;
      if (this.routeChoice.remainingSeconds <= 0) this.chooseRoute('direct');
      return;
    }
    if (this.state.kingPaused || (!this.state.forceAdvance && this.coveragePercent() < ADVANCE_COVERAGE_THRESHOLD) || this.vip.pathIdx >= this.vipPath.length - 1) return;
    this.vip.t += (VIP_SPEED / CS) * dt;
    while (this.vip.t >= 1 && this.vip.pathIdx < this.vipPath.length - 1) {
      this.vip.t -= 1;
      this.vip.pathIdx += 1;
    }
    if (!this.routeChoiceShown && this.vip.pathIdx >= Math.floor(this.vipPath.length * 0.38)) this.openRouteChoice();
    if (this.vip.pathIdx < this.vipPath.length - 1) {
      const a = this.vipPath[this.vip.pathIdx];
      const b = this.vipPath[this.vip.pathIdx + 1];
      this.vip.x = a.x + (b.x - a.x) * this.vip.t;
      this.vip.z = a.z + (b.z - a.z) * this.vip.t;
      return;
    }
    const last = this.vipPath[this.vipPath.length - 1];
    this.vip.x = last.x;
    this.vip.z = last.z;
    this.state.won = true;
    this.finalizeRun('cleared');
  }

  private openRouteChoice(): void {
    this.routeChoiceShown = true;
    const grid = w2gi(this.vip.x, this.vip.z);
    const origin = { x: grid.gx, y: grid.gy };
    const direct = this.vipPath.slice(this.vip.pathIdx);
    const detour = buildDetourVipPath(this.city, origin, direct);
    if (detour.length < 2 || pathLength(detour) <= pathLength(direct) * 1.1) return;
    this.routeChoice = { remainingSeconds: 5, options: new Map([['direct', direct], ['detour', detour]]) };
  }

  private chooseRoute(route: 'direct' | 'detour'): { ok: true } | { ok: false; error: string } {
    const choice = this.routeChoice;
    const path = choice?.options.get(route);
    if (!choice || !path) return { ok: false, error: 'no route choice available' };
    this.vipPath = [...this.vipPath.slice(0, this.vip.pathIdx + 1), ...path.slice(1)];
    this.routeChoice = null;
    return { ok: true };
  }

  private autoDeployUnits(): void {
    if (this.state.wave >= 3) this.autoRepositionEmplacement();
    const targetCount = 4 + this.state.wave * 2;
    if (this.units.length >= targetCount) return;
    let guard = 0;
    while (this.state.gold >= 40 && this.units.length < targetCount && guard < 8) {
      const type = pickAutoPieceType(this.state.wave, this.state.gold, this.units.length);
      guard += 1;
      if (this.state.wave >= 2 && (this.units.length + this.state.wave) % 3 === 0 && this.autoPlaceNearKing(type === 'rook' ? 'bishop' : 'rook')) continue;
      if (!this.spawnUnitNearKing(type)) continue;
      if (this.state.gold < 40) break;
    }
  }

  private autoPlaceNearKing(type: 'rook' | 'bishop'): boolean {
    if (this.state.gold < PIECE[type].cost || this.units.length >= this.unitLimit) return false;
    const placement = this.findAutoPlacement();
    return placement !== null && this.placeUnit(placement.gx, placement.gy, type).ok;
  }

  private autoRepositionEmplacement(): void {
    const stale = this.units.find((unit) => unit.deployed && (unit.type === 'rook' || unit.type === 'bishop') && Math.hypot(unit.wx - this.vip.x, unit.wz - this.vip.z) > CS * 9);
    const placement = this.findAutoPlacement();
    if (!stale || !placement || this.state.gold + getEscortReclaimGold(PIECE[stale.type].cost) < PIECE[stale.type].cost) return;
    const type = stale.type;
    if (!this.reclaimAt(stale.gx, stale.gy).ok) return;
    this.placeUnit(placement.gx, placement.gy, type);
  }

  private findAutoPlacement(): { gx: number; gy: number } | null {
    const center = w2gi(this.vip.x, this.vip.z);
    for (let radius = 2; radius <= 6; radius++) {
      for (const [dx, dy] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius], [radius, radius], [-radius, radius], [radius, -radius], [-radius, -radius]]) {
        const gx = center.gx + dx;
        const gy = center.gy + dy;
        if (this.canPlaceAt(gx, gy, false)) return { gx, gy };
      }
    }
    return null;
  }

  private spawnUnitNearKing(type: EscortTdPieceType): boolean {
    if (this.units.length >= this.unitLimit) return false;
    const def = PIECE[type];
    if (this.state.gold < def.cost) return false;
    this.state.gold -= def.cost;
    const guard = UNIT_GUARD[type];
    const slot = this.units.length;
    const ang = (slot * Math.PI * 0.7) % (Math.PI * 2);
    const radius = Math.max(CS * 1.2, guard.patrolRadius * 0.6);
    const wx = this.vip.x + Math.cos(ang) * radius;
    const wz = this.vip.z + Math.sin(ang) * radius;
    const grid = w2gi(wx, wz);
    this.createUnit(type, wx, wz, false);
    return true;
  }

  private createUnit(type: EscortTdPieceType, wx: number, wz: number, deployed: boolean): void {
    const guard = UNIT_GUARD[type];
    const grid = w2gi(wx, wz);
    const facing = Math.atan2(wz - this.vip.z, wx - this.vip.x);
    this.units.push({
      id: this.nextUnitId++,
      type,
      gx: grid.gx,
      gy: grid.gy,
      wx,
      wz,
      fireTimer: 0,
      speedMul: guard.speedMul,
      windupTimer: 0,
      pendingAttack: null,
      moveFacing: facing,
      aimFacing: facing,
      patrolAngle: deployed ? 0 : Math.atan2(wz - this.vip.z, wx - this.vip.x),
      patrolRadius: guard.patrolRadius,
      deployed,
      hp: guardHp(type),
      hpMax: guardHp(type),
      respawnTimer: 0,
    });
  }

  private moveUnits(dt: number): void {
    for (const unit of this.units) {
      if (unit.respawnTimer > 0) {
        unit.respawnTimer = Math.max(0, unit.respawnTimer - dt);
        if (unit.respawnTimer === 0) {
          unit.hp = unit.hpMax;
          unit.wx = this.vip.x;
          unit.wz = this.vip.z;
        }
        continue;
      }
      if (unit.deployed) continue;
      unit.patrolAngle += dt * (0.4 + unit.speedMul * 0.08);
      const intercept = pickInterceptTarget(unit, this.enemies, this.vip.x, this.vip.z);
      const desired = intercept
        ? buildInterceptPoint(unit, intercept, this.vip.x, this.vip.z)
        : isGroundGuard(unit.type)
          ? this.guardFormationTarget(unit)
        : {
            x: this.vip.x + Math.cos(unit.patrolAngle) * unit.patrolRadius,
            z: this.vip.z + Math.sin(unit.patrolAngle) * unit.patrolRadius,
          };
      const dx = desired.x - unit.wx;
      const dz = desired.z - unit.wz;
      const dist = Math.hypot(dx, dz);
      const step = Math.min(dist, CS * unit.speedMul * dt);
      if (dist > 0.001) {
        unit.wx += (dx / dist) * step;
        unit.wz += (dz / dist) * step;
        unit.moveFacing = Math.atan2(dz, dx);
      }
      if (!intercept) unit.aimFacing = blendAngle(unit.aimFacing, unit.moveFacing, Math.min(1, dt * 2.5));
      const grid = w2gi(unit.wx, unit.wz);
      unit.gx = grid.gx;
      unit.gy = grid.gy;
    }
  }

  private guardFormationTarget(unit: Unit): { x: number; z: number } {
    const next = this.vipPath[Math.min(this.vip.pathIdx + 1, this.vipPath.length - 1)] ?? this.vip;
    const dx = next.x - this.vip.x;
    const dz = next.z - this.vip.z;
    const length = Math.hypot(dx, dz) || 1;
    const forward = { x: dx / length, z: dz / length };
    const side = { x: -forward.z, z: forward.x };
    const guardIndex = this.units.filter((other) => !other.deployed && isGroundGuard(other.type)).findIndex((other) => other.id === unit.id);
    const role = Math.max(0, guardIndex) % 4;
    const offsets = [
      { forward: 1.6, side: 0 },
      this.state.rallyPoints.left,
      this.state.rallyPoints.right,
      this.state.rallyPoints.rear,
    ][role];
    return {
      x: this.vip.x + forward.x * CS * offsets.forward + side.x * CS * offsets.side,
      z: this.vip.z + forward.z * CS * offsets.forward + side.z * CS * offsets.side,
    };
  }

  private refreshEnemyFlow(): void {
    const grid = w2gi(this.vip.x, this.vip.z);
    this.enemyFlow = bfsFlow(this.navigationGrid(), this.city.width, this.city.height, clamp(grid.gx, 0, this.city.width - 1), clamp(grid.gy, 0, this.city.height - 1));
  }

  private moveEnemies(dt: number): void {
    const hitR2 = (CS * 0.5) ** 2;
    let barricadeDestroyed = false;
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const blockingGuard = enemy.kind !== 'air' ? this.findBlockingGuard(enemy) : null;
      if (blockingGuard) {
        blockingGuard.hp -= ENEMY_GUARD_DAMAGE_PER_SECOND * dt;
        if (blockingGuard.hp <= 0) {
          blockingGuard.hp = 0;
          blockingGuard.respawnTimer = GUARD_REFORM_SECONDS;
        }
        enemy.bobPhase += dt;
        enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
        continue;
      }
      if (enemy.kind === 'air') {
        moveEnemyToward(enemy, this.vip.x, this.vip.z, dt, 1.12);
      } else {
        const grid = w2gi(enemy.x, enemy.z);
        if (grid.gx >= 0 && grid.gx < this.city.width && grid.gy >= 0 && grid.gy < this.city.height) {
          const fi = this.enemyFlow[grid.gy * this.city.width + grid.gx];
          if (fi >= 0) {
            enemy.x += D4[fi][0] * enemy.speed * dt;
            enemy.z += D4[fi][1] * enemy.speed * dt;
          } else if (enemy.kind === 'siege') {
            barricadeDestroyed = this.damageNearestBarricade(enemy, dt) || barricadeDestroyed;
          }
        }
      }
      enemy.bobPhase += dt;
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      const dx = enemy.x - this.vip.x;
      const dz = enemy.z - this.vip.z;
      if (dx * dx + dz * dz < hitR2) {
        this.vip.hp -= ENEMY_DMG;
        enemy.dead = true;
        if (this.vip.hp <= 0) {
          this.vip.hp = 0;
          this.state.over = true;
          this.finalizeRun('failed');
        }
      }
    }
    if (barricadeDestroyed) this.refreshEnemyFlow();
  }

  private separateEnemies(dt: number): void {
    const sepR2 = ENEMY_SEP_RADIUS * ENEMY_SEP_RADIUS;
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i];
      if (a.dead) continue;
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j];
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

  private cleanupDeadEnemies(): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].dead) this.enemies.splice(i, 1);
    }
  }

  private runUnitAttacks(dt: number): void {
    for (const unit of this.units) {
      const def = this.getPieceStats(unit.type);
      if (unit.respawnTimer > 0) continue;
      if (unit.windupTimer > 0) {
        unit.windupTimer -= dt;
        if (unit.windupTimer > 0) continue;
        this.resolvePendingAttack(unit, def.dmg);
        unit.pendingAttack = null;
        unit.fireTimer = def.fireRate;
        continue;
      }
      unit.fireTimer -= dt;
      if (unit.fireTimer > 0) continue;
      let target: Enemy | null = null;
      let best = Number.POSITIVE_INFINITY;
      const range2 = def.range * def.range;
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        if (!canEscortUnitAttackTarget(unit.type, this.isEnemyDetected(enemy))) continue;
        const dx = enemy.x - unit.wx;
        const dz = enemy.z - unit.wz;
        const d2 = dx * dx + dz * dz;
        if (d2 > range2) continue;
        const score = scoreEnemy(enemy.kind, d2, this.state.commandMode);
        if (score < best) {
          best = score;
          target = enemy;
        }
      }
      if (!target) continue;
      unit.aimFacing = Math.atan2(target.z - unit.wz, target.x - unit.wx);
      unit.pendingAttack = {
        x: target.x,
        z: target.z,
        shape: def.attackShape,
        radius: Math.max(def.aoe, def.attackShape === 'square' ? CS * 1.2 : CS * 0.5),
        facing: unit.aimFacing,
        targetEnemyId: target.id,
      };
      unit.windupTimer = def.attackWindup;
    }
  }

  private resolvePendingAttack(unit: Unit, dmg: number): void {
    const attack = unit.pendingAttack;
    if (!attack) return;
    const def = PIECE[unit.type];

    // Queen: instant laser — apply AoE damage immediately and emit visual event
    if (unit.type === 'queen') {
      const half = attack.radius;
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        if (Math.abs(enemy.x - attack.x) <= half && Math.abs(enemy.z - attack.z) <= half) this.applyEnemyDamage(enemy, dmg, unit.type);
      }
      this.laserEvents.push({ fromX: unit.wx, fromZ: unit.wz, toX: attack.x, toZ: attack.z, aoeRadius: attack.radius });
      return;
    }

    // All other weapons: spawn flying projectile(s)
    const baseAngle = attack.facing;
    const spread = def.projSpread;
    const count = def.projCount;
    for (let i = 0; i < count; i++) {
      const offset = count > 1 ? spread * (i / (count - 1) - 0.5) : 0;
      const angle = baseAngle + offset;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      // Bishop tracks the specific enemy; others fly straight
      const homing = unit.type === 'bishop' ? (attack.targetEnemyId ?? null) : null;
      const targetDist = Math.hypot(attack.x - unit.wx, attack.z - unit.wz) || def.range;
      this.flyingProjectiles.push({
        id: this.nextProjectileId++,
        unitType: unit.type,
        x: unit.wx, z: unit.wz,
        fromX: unit.wx, fromZ: unit.wz,
        dirX: dx, dirZ: dz,
        homingId: homing,
        targetX: unit.wx + dx * targetDist,
        targetZ: unit.wz + dz * targetDist,
        damage: dmg,
        aoeRadius: def.aoe,
        hitRadius: def.projHitR,
        speed: def.projSpeed,
        maxRange: def.range * 1.1,
        traveled: 0,
      });
    }
  }

  private moveProjectiles(dt: number): void {
    for (let i = this.flyingProjectiles.length - 1; i >= 0; i--) {
      const proj = this.flyingProjectiles[i];

      // Bishop homing: redirect toward current enemy position
      if (proj.homingId !== null) {
        const prey = this.enemies.find((e) => e.id === proj.homingId && !e.dead);
        if (prey) {
          proj.targetX = prey.x;
          proj.targetZ = prey.z;
          const ddx = prey.x - proj.x;
          const ddz = prey.z - proj.z;
          const len = Math.hypot(ddx, ddz) || 1;
          // Blend direction for smooth curve
          proj.dirX += (ddx / len - proj.dirX) * Math.min(1, dt * 6);
          proj.dirZ += (ddz / len - proj.dirZ) * Math.min(1, dt * 6);
          const norm = Math.hypot(proj.dirX, proj.dirZ) || 1;
          proj.dirX /= norm;
          proj.dirZ /= norm;
        }
      }

      const step = proj.speed * dt;
      proj.x += proj.dirX * step;
      proj.z += proj.dirZ * step;
      proj.traveled += step;

      // Hit detection
      let hit = false;
      if (proj.aoeRadius > 0) {
        // AoE (Rook): trigger when close to target position
        const ddx = proj.targetX - proj.x;
        const ddz = proj.targetZ - proj.z;
        if (ddx * ddx + ddz * ddz <= proj.hitRadius * proj.hitRadius) {
          const r2 = proj.aoeRadius * proj.aoeRadius;
          for (const enemy of this.enemies) {
            if (enemy.dead) continue;
            const ex = enemy.x - proj.x;
            const ez = enemy.z - proj.z;
            if (ex * ex + ez * ez <= r2) this.applyEnemyDamage(enemy, proj.damage, proj.unitType);
          }
          hit = true;
        }
      } else {
        // Single-target: first enemy in hit radius
        for (const enemy of this.enemies) {
          if (enemy.dead) continue;
          const ex = enemy.x - proj.x;
          const ez = enemy.z - proj.z;
          if (ex * ex + ez * ez <= proj.hitRadius * proj.hitRadius) {
            this.applyEnemyDamage(enemy, proj.damage, proj.unitType);
            hit = true;
            break;
          }
        }
      }

      if (hit || proj.traveled >= proj.maxRange) {
        this.flyingProjectiles.splice(i, 1);
      }
    }
  }

  private applyEnemyDamage(enemy: Enemy, dmg: number, attacker: EscortTdPieceType): void {
    enemy.hp -= dmg * getEscortDamageMultiplier(attacker, enemy.kind);
    enemy.hitFlash = 0.12;
    if (enemy.hp <= 0) {
      enemy.dead = true;
      this.state.gold += GOLD_KILL;
      this.state.kills[enemy.kind] += 1;
    }
  }

  private updateSpawns(): void {
    const progress = this.progressPercent() / 100;
    if (progress < this.nextSpawnProgress) return;
    this.state.wave += 1;
    this.spawnWave(this.state.wave, this.spawnPoints);
    this.nextSpawnProgress += getEscortSpawnInterval(progress);
  }

  private spawnWave(wave: number, points: SpawnPoints): void {
    const count = WAVE_BASE + wave * 4;
    const hp = ENEMY_HP_BASE * (1 + wave * 0.18);
    const speed = ENEMY_SPEED_BASE * (1 + wave * 0.05);
    for (let i = 0; i < count; i++) {
      const kind = pickEnemyKind();
      const pool = points[kind];
      const c = pool[(Math.random() * Math.max(1, pool.length)) | 0] ?? this.city.start;
      const p = g2w(c.x, c.y);
      const jx = (Math.random() - 0.5) * CS * (kind === 'air' ? 2.5 : 0.3);
      const jz = (Math.random() - 0.5) * CS * (kind === 'air' ? 2.5 : 0.3);
      this.enemies.push({
        id: this.nextEnemyId++,
        x: p.x + jx,
        z: p.z + jz,
        hp: hp * (kind === 'siege' ? 1.35 : kind === 'air' ? 0.85 : 1),
        speed: speed * (kind === 'air' ? 1.18 : kind === 'siege' ? 0.84 : 1),
        dead: false,
        hitFlash: 0,
        kind,
        bobPhase: Math.random() * Math.PI * 2,
      });
    }
  }

  private counts(): EscortTdCountsSnapshot {
    const counts: EscortTdCountsSnapshot = { pawn: 0, rook: 0, bishop: 0, knight: 0, queen: 0, ground: 0, air: 0, siege: 0 };
    for (const unit of this.units) counts[unit.type] += 1;
    for (const enemy of this.enemies) if (!enemy.dead) counts[enemy.kind] += 1;
    return counts;
  }

  private placeUnit(gx: number, gy: number, type: EscortTdPieceType): { ok: true } | { ok: false; error: string } {
    if (!PIECE[type]) return { ok: false, error: 'invalid unit type' };
    if (this.units.length >= this.unitLimit) return { ok: false, error: 'unit limit reached' };
    if (!this.canPlaceAt(gx, gy, type === 'pawn' || type === 'queen')) return { ok: false, error: 'invalid placement' };
    const def = PIECE[type];
    if (this.state.gold < def.cost) return { ok: false, error: 'not enough gold' };
    this.state.gold -= def.cost;
    const world = g2w(gx, gy);
    this.createUnit(type, world.x, world.z, true);
    if (type !== 'pawn' && type !== 'queen') this.refreshEnemyFlow();
    return { ok: true };
  }

  private placeBarricade(gx: number, gy: number): { ok: true } | { ok: false; error: string } {
    const cost = 30;
    if (!this.canPlaceAt(gx, gy, false)) return { ok: false, error: 'invalid placement' };
    if (this.state.gold < cost) return { ok: false, error: 'not enough gold' };
    this.state.gold -= cost;
    this.barricades.push({ id: this.nextBarricadeId++, gx, gy, hp: 120, hpMax: 120 });
    this.refreshEnemyFlow();
    return { ok: true };
  }

  private reclaimAt(gx: number, gy: number): { ok: true } | { ok: false; error: string } {
    const unitIndex = this.units.findIndex((unit) => unit.deployed && unit.gx === gx && unit.gy === gy);
    if (unitIndex >= 0) {
      const [unit] = this.units.splice(unitIndex, 1);
      this.state.gold += getEscortReclaimGold(PIECE[unit.type].cost);
      if (unit.type !== 'pawn' && unit.type !== 'queen') this.refreshEnemyFlow();
      return { ok: true };
    }
    const barricadeIndex = this.barricades.findIndex((barricade) => barricade.gx === gx && barricade.gy === gy);
    if (barricadeIndex >= 0) {
      this.barricades.splice(barricadeIndex, 1);
      this.state.gold += getEscortReclaimGold(30);
      this.refreshEnemyFlow();
      return { ok: true };
    }
    return { ok: false, error: 'nothing to reclaim' };
  }

  private canPlaceAt(gx: number, gy: number, flying: boolean): boolean {
    if (gx < 0 || gx >= this.city.width || gy < 0 || gy >= this.city.height) return false;
    if (!flying && this.city.g[gy][gx] !== 0) return false;
    if (this.isRemainingKingPath(gx, gy)) return false;
    if (this.barricades.some((barricade) => barricade.gx === gx && barricade.gy === gy)) return false;
    return !this.units.some((unit) => unit.gx === gx && unit.gy === gy && unit.deployed);
  }

  private isRemainingKingPath(gx: number, gy: number): boolean {
    for (let index = this.vip.pathIdx; index < this.vipPath.length; index++) {
      const cell = w2gi(this.vipPath[index].x, this.vipPath[index].z);
      if (cell.gx === gx && cell.gy === gy) return true;
    }
    return false;
  }

  private navigationGrid(): Uint8Array[] {
    const grid = this.city.g.map((row) => row.slice());
    for (const barricade of this.barricades) grid[barricade.gy][barricade.gx] = 1;
    for (const unit of this.units) {
      if (unit.deployed && unit.type !== 'pawn' && unit.type !== 'queen') grid[unit.gy][unit.gx] = 1;
    }
    return grid;
  }

  private enemyApproachPaths(): EscortTdStateSnapshot['approachPaths'] {
    return (['ground', 'siege', 'air'] as EscortTdEnemyKind[]).map((kind) => ({ kind, points: this.enemyApproachPath(kind) }));
  }

  private enemyApproachPath(kind: EscortTdEnemyKind): Array<{ x: number; z: number }> {
    const start = this.spawnPoints[kind][0];
    if (!start) return [];
    const points: Array<{ x: number; z: number }> = [];
    if (kind === 'air') {
      const point = g2w(start.x, start.y);
      return [{ x: point.x, z: point.z }, { x: this.vip.x, z: this.vip.z }];
    }
    let x = start.x;
    let y = start.y;
    for (let step = 0; step < this.city.width * this.city.height; step++) {
      const point = g2w(x, y);
      points.push({ x: point.x, z: point.z });
      const direction = this.enemyFlow[y * this.city.width + x];
      if (direction < 0) break;
      x += D4[direction][0];
      y += D4[direction][1];
      if (x < 0 || x >= this.city.width || y < 0 || y >= this.city.height) break;
    }
    return points;
  }

  private damageNearestBarricade(enemy: Enemy, dt: number): boolean {
    let target: Barricade | null = null;
    let bestDistance = CS * CS * 2.2;
    for (const barricade of this.barricades) {
      const point = g2w(barricade.gx, barricade.gy);
      const distance = (point.x - enemy.x) ** 2 + (point.z - enemy.z) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        target = barricade;
      }
    }
    if (!target) return false;
    target.hp -= SIEGE_BARRICADE_DAMAGE_PER_SECOND * dt;
    if (target.hp > 0) return false;
    const index = this.barricades.indexOf(target);
    if (index >= 0) this.barricades.splice(index, 1);
    return true;
  }

  private findBlockingGuard(enemy: Enemy): Unit | null {
    const blockRange2 = (CS * 0.85) ** 2;
    return this.units.find((unit) => isGroundGuard(unit.type) && unit.respawnTimer <= 0 && (unit.wx - enemy.x) ** 2 + (unit.wz - enemy.z) ** 2 <= blockRange2) ?? null;
  }

  private coveragePercent(): number {
    const next = this.vipPath[Math.min(this.vip.pathIdx + 1, this.vipPath.length - 1)];
    if (!next) return 100;
    const samples = 8;
    return calculateEscortCoverage(samples, (index) => {
      const t = index / samples;
      const x = this.vip.x + (next.x - this.vip.x) * t;
      const z = this.vip.z + (next.z - this.vip.z) * t;
      return this.isPointDetected(x, z);
    });
  }

  private isEnemyDetected(enemy: Enemy): boolean {
    return this.isPointDetected(enemy.x, enemy.z);
  }

  private isPointDetected(x: number, z: number): boolean {
    if ((x - this.vip.x) ** 2 + (z - this.vip.z) ** 2 <= VIP_VISION ** 2) return true;
    return this.units.some((unit) => unit.type === 'pawn' && (x - unit.wx) ** 2 + (z - unit.wz) ** 2 <= PAWN_VISION ** 2);
  }

  private progressPercent(): number {
    const segments = Math.max(1, this.vipPath.length - 1);
    return Math.round(Math.min(1, (this.vip.pathIdx + this.vip.t) / segments) * 100);
  }

  private getPieceStats(type: EscortTdPieceType) {
    const base = PIECE[type];
    const key = `${type}PowerLevel` as keyof EscortTdMetaProgress;
    const level = (this.meta[key] as number) ?? 0;
    const mul = getEscortUnitPowerMultipliers(level);
    return {
      ...base,
      dmg: base.dmg * mul.dmgMul,
      range: base.range * mul.rangeMul,
      fireRate: base.fireRate * mul.fireRateMul,
    };
  }

  private finalizeRun(outcome: EscortTdRunResult['outcome']): void {
    if (this.state.result) return;
    const progressPercent = this.progressPercent();
    const kills = { ...this.state.kills };
    const { score, chips } = calculateEscortResult(outcome, progressPercent, kills);
    this.state.result = {
      outcome,
      progressPercent,
      kills,
      score,
      chips,
    };
  }
}
