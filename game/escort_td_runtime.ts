import type {
  EscortTdAction,
  EscortTdCommandMode,
  EscortTdCountsSnapshot,
  EscortTdEnemyKind,
  EscortTdEnemySnapshot,
  EscortTdMetaProgress,
  EscortTdPieceType,
  EscortTdRunResult,
  EscortTdStateSnapshot,
  EscortTdUnitSnapshot,
} from '../shared/types/escort_td';
import { calculateEscortCoverage, calculateEscortResult, getEscortMetaValues, getEscortReclaimGold, getEscortSpawnInterval, normalizeEscortMeta } from './escort_td_rules';

const GW = 21;
const GH = 17;
const CS = 5;
const ROAD = 4;
const VIP_HP_MAX = 400;
const VIP_SPEED = 6;
const ENEMY_SPEED_BASE = 7;
const ENEMY_HP_BASE = 28;
const ENEMY_DMG = 20;
const ENEMY_SEP_RADIUS = CS * 0.6;
const ENEMY_SEP_FORCE = 3.5;
const GOLD_KILL = 8;
const START_GOLD = 100;
const WAVE_BASE = 8;
const SIEGE_BARRICADE_DAMAGE_PER_SECOND = 35;
const VIP_VISION = CS * 2;
const PAWN_VISION = CS * 5;
const ADVANCE_COVERAGE_THRESHOLD = 65;

const PIECE: Record<EscortTdPieceType, { cost: number; range: number; fireRate: number; dmg: number; aoe: number; attackShape: 'fan' | 'circle' | 'square'; attackWindup: number }> = {
  pawn: { cost: 40, range: CS * 3.5, fireRate: 0.48, dmg: 14, aoe: 0, attackShape: 'fan', attackWindup: 0.08 },
  rook: { cost: 80, range: CS * 6, fireRate: 1.0, dmg: 38, aoe: CS * 1.6, attackShape: 'circle', attackWindup: 0.78 },
  bishop: { cost: 70, range: CS * 8, fireRate: 1.2, dmg: 45, aoe: 0, attackShape: 'square', attackWindup: 0.72 },
  knight: { cost: 90, range: CS * 1.8, fireRate: 0.14, dmg: 6, aoe: 0, attackShape: 'square', attackWindup: 0.03 },
  queen: { cost: 150, range: CS * 12, fireRate: 4.0, dmg: 160, aoe: CS * 3.2, attackShape: 'square', attackWindup: 1.0 },
};

const UNIT_GUARD: Record<EscortTdPieceType, { speedMul: number; patrolRadius: number; interceptBias: number }> = {
  pawn: { speedMul: 2.4, patrolRadius: CS * 3.4, interceptBias: 1.2 },
  rook: { speedMul: 1.25, patrolRadius: CS * 2.1, interceptBias: 0.65 },
  bishop: { speedMul: 1.8, patrolRadius: CS * 3.0, interceptBias: 1.0 },
  knight: { speedMul: 2.7, patrolRadius: CS * 2.5, interceptBias: 1.55 },
  queen: { speedMul: 1.45, patrolRadius: CS * 3.7, interceptBias: 0.8 },
};

const COMMAND_MODES: EscortTdCommandMode[] = ['balanced', 'ground', 'air', 'siege'];
const D4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

type GridPt = { x: number; y: number };
type RoadRoute = { kind: 'main' | 'loop' | 'branch'; points: GridPt[] };
type SpawnPoints = { ground: GridPt[]; air: GridPt[]; siege: GridPt[] };
type CityData = { width: number; height: number; g: Uint8Array[]; start: GridPt; end: GridPt; route: GridPt[]; roads: RoadRoute[]; spawnPoints: SpawnPoints };
type Enemy = EscortTdEnemySnapshot & { dead: boolean; speed: number };
type Unit = EscortTdUnitSnapshot & { fireTimer: number; speedMul: number; windupTimer: number; patrolAngle: number; pendingAttack: null | { x: number; z: number; shape: 'fan' | 'circle' | 'square'; radius: number; facing: number } };
type Barricade = { id: number; gx: number; gy: number; hp: number; hpMax: number };

export class EscortTdRuntime {
  private readonly citySeed: number;
  private readonly meta: EscortTdMetaProgress;
  private readonly vipHpMax: number;
  private readonly unitLimit: number;
  private readonly city: CityData;
  private readonly vipPath: Array<{ x: number; z: number }>;
  private readonly spawnPoints: SpawnPoints;
  private readonly units: Unit[] = [];
  private readonly enemies: Enemy[] = [];
  private readonly barricades: Barricade[] = [];
  private readonly vip: { hp: number; pathIdx: number; t: number; x: number; z: number };
  private readonly state = {
    gold: START_GOLD,
    wave: 0,
    commandMode: 'balanced' as EscortTdCommandMode,
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

  constructor(seed = (Math.random() * 0xffffff) | 0, meta: Partial<EscortTdMetaProgress> = {}) {
    this.meta = normalizeEscortMeta(meta);
    const metaValues = getEscortMetaValues(this.meta);
    this.vipHpMax = metaValues.kingHpMax;
    this.unitLimit = metaValues.unitLimit;
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
    const dt = Math.min((now - this.lastTickAt) / 1000, 0.05);
    this.lastTickAt = now;
    if (dt > 0) this.tick(dt);
  }

  getSnapshot(): EscortTdStateSnapshot {
    this.tickToNow();
    return {
      page: 'escort_td',
      updatedAt: new Date().toISOString(),
      citySeed: this.citySeed,
      wave: this.state.wave,
      gold: this.state.gold,
      commandMode: this.state.commandMode,
      meta: this.meta,
      progressPercent: this.progressPercent(),
      king: {
        x: this.vip.x,
        z: this.vip.z,
        hp: this.vip.hp,
        hpMax: this.vipHpMax,
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
      })),
      barricades: this.barricades.map((barricade) => ({ ...barricade })),
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
    this.updateSpawns();
  }

  private advanceVip(dt: number): void {
    if (this.state.kingPaused || (!this.state.forceAdvance && this.coveragePercent() < ADVANCE_COVERAGE_THRESHOLD) || this.vip.pathIdx >= this.vipPath.length - 1) return;
    this.vip.t += (VIP_SPEED / CS) * dt;
    while (this.vip.t >= 1 && this.vip.pathIdx < this.vipPath.length - 1) {
      this.vip.t -= 1;
      this.vip.pathIdx += 1;
    }
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

  private autoDeployUnits(): void {
    const targetCount = 4 + this.state.wave * 2;
    if (this.units.length >= targetCount) return;
    let guard = 0;
    while (this.state.gold >= 40 && this.units.length < targetCount && guard < 8) {
      const type = pickAutoPieceType(this.state.wave, this.state.gold, this.units.length);
      guard += 1;
      if (!this.spawnUnitNearKing(type)) continue;
      if (this.state.gold < 40) break;
    }
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
    });
  }

  private moveUnits(dt: number): void {
    for (const unit of this.units) {
      if (unit.deployed) continue;
      unit.patrolAngle += dt * (0.4 + unit.speedMul * 0.08);
      const intercept = pickInterceptTarget(unit, this.enemies, this.vip.x, this.vip.z);
      const desired = intercept
        ? buildInterceptPoint(unit, intercept, this.vip.x, this.vip.z)
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

  private refreshEnemyFlow(): void {
    const grid = w2gi(this.vip.x, this.vip.z);
    this.enemyFlow = bfsFlow(this.navigationGrid(), this.city.width, this.city.height, clamp(grid.gx, 0, this.city.width - 1), clamp(grid.gy, 0, this.city.height - 1));
  }

  private moveEnemies(dt: number): void {
    const hitR2 = (CS * 0.5) ** 2;
    let barricadeDestroyed = false;
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const blocked = enemy.kind !== 'air' && this.isBlockedByKnight(enemy);
      if (blocked) {
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
      const def = PIECE[unit.type];
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
        if (!this.isEnemyDetected(enemy)) continue;
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
      };
      unit.windupTimer = def.attackWindup;
    }
  }

  private resolvePendingAttack(unit: Unit, dmg: number): void {
    const attack = unit.pendingAttack;
    if (!attack) return;
    if (attack.shape === 'square') {
      const half = attack.radius;
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        if (Math.abs(enemy.x - attack.x) <= half && Math.abs(enemy.z - attack.z) <= half) this.applyEnemyDamage(enemy, dmg);
      }
      return;
    }
    if (attack.shape === 'circle') {
      const r2 = attack.radius * attack.radius;
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        const dx = enemy.x - attack.x;
        const dz = enemy.z - attack.z;
        if (dx * dx + dz * dz <= r2) this.applyEnemyDamage(enemy, dmg);
      }
      return;
    }
    const dir = { x: Math.cos(attack.facing), z: Math.sin(attack.facing) };
    const coneCos = Math.cos(Math.PI / 5.5);
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dx = enemy.x - unit.wx;
      const dz = enemy.z - unit.wz;
      const dist = Math.hypot(dx, dz);
      if (dist > attack.radius) continue;
      const dot = (dx / Math.max(dist, 0.0001)) * dir.x + (dz / Math.max(dist, 0.0001)) * dir.z;
      if (dot >= coneCos) this.applyEnemyDamage(enemy, dmg);
    }
  }

  private applyEnemyDamage(enemy: Enemy, dmg: number): void {
    enemy.hp -= dmg;
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

  private isBlockedByKnight(enemy: Enemy): boolean {
    const blockRange2 = (CS * 0.85) ** 2;
    return this.units.some((unit) => unit.type === 'knight' && (unit.wx - enemy.x) ** 2 + (unit.wz - enemy.z) ** 2 <= blockRange2);
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

function mkRng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildCity(width: number, height: number, seed: number): CityData {
  const rand = mkRng(seed);
  const g: Uint8Array[] = Array.from({ length: height }, () => new Uint8Array(width).fill(1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x % ROAD !== 0 && y % ROAD !== 0) g[y][x] = rand() < 0.62 ? 1 : 0;
    }
  }
  const cornerPairs: [GridPt, GridPt][] = [
    [{ x: 0, y: 0 }, { x: width - 1, y: height - 1 }],
    [{ x: width - 1, y: 0 }, { x: 0, y: height - 1 }],
  ];
  const [start, end] = cornerPairs[(rand() * cornerPairs.length) | 0];
  const route = buildMainRoute(start, end, width, height, rand);
  const roads = buildRoadNetwork(route, width, height, rand);
  const roadRoutes: RoadRoute[] = [{ kind: 'main', points: route }, ...roads];
  for (const road of roadRoutes) carveEscortRoute(g, road.points, rand);
  carvePlaza(g, start, 2);
  carvePlaza(g, end, 2);
  for (let i = 1; i < route.length - 1; i++) if (i % 2 === 1) carvePlaza(g, route[i], 1);
  return { g, width, height, start, end, route, roads: roadRoutes, spawnPoints: buildSpawnPoints(g, roadRoutes, width, height, rand) };
}

function bfsFlow(g: Uint8Array[], width: number, height: number, goalX: number, goalY: number): Int8Array {
  const inf = 0x7fffffff;
  const dist = new Int32Array(width * height).fill(inf);
  const flow = new Int8Array(width * height).fill(-1);
  dist[goalY * width + goalX] = 0;
  const q: number[] = [goalY * width + goalX];
  for (let head = 0; head < q.length; head++) {
    const idx = q[head];
    const x = idx % width;
    const y = (idx / width) | 0;
    const d = dist[idx];
    for (let di = 0; di < 4; di++) {
      const nx = x + D4[di][0];
      const ny = y + D4[di][1];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ni = ny * width + nx;
      if (g[ny][nx] === 1 || dist[ni] < inf) continue;
      dist[ni] = d + 1;
      q.push(ni);
    }
  }
  for (let i = 0; i < width * height; i++) {
    if (dist[i] === inf) continue;
    const x = i % width;
    const y = (i / width) | 0;
    let best = -1;
    let bestDist = dist[i];
    for (let di = 0; di < 4; di++) {
      const nx = x + D4[di][0];
      const ny = y + D4[di][1];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nextDist = dist[ny * width + nx];
      if (nextDist < bestDist) {
        bestDist = nextDist;
        best = di;
      }
    }
    flow[i] = best;
  }
  return flow;
}

function g2w(gx: number, gy: number): { x: number; z: number } {
  return { x: (gx - GW / 2 + 0.5) * CS, z: (gy - GH / 2 + 0.5) * CS };
}

function w2gi(wx: number, wz: number): { gx: number; gy: number } {
  return { gx: Math.floor(wx / CS + GW / 2), gy: Math.floor(wz / CS + GH / 2) };
}

function buildMainRoute(start: GridPt, end: GridPt, width: number, height: number, rand: () => number): GridPt[] {
  const x1 = clampGrid(Math.floor(width * 0.18) + (rand() < 0.5 ? 0 : ROAD), 1, width - 2);
  const x2 = clampGrid(Math.floor(width * 0.44), 1, width - 2);
  const x3 = clampGrid(Math.floor(width * 0.68), 1, width - 2);
  const y1 = clampGrid(Math.floor(height * 0.20) + (rand() < 0.5 ? 0 : ROAD), 1, height - 2);
  const y2 = clampGrid(Math.floor(height * 0.44), 1, height - 2);
  const y3 = clampGrid(Math.floor(height * 0.69), 1, height - 2);
  return dedupeRoute([start, { x: start.x, y: y1 }, { x: x1, y: y1 }, { x: x1, y: y2 }, { x: x2, y: y2 }, { x: x2, y: y3 }, { x: x3, y: y3 }, { x: end.x, y: y3 }, end]);
}

function carveEscortRoute(g: Uint8Array[], route: GridPt[], rand: () => number): void {
  for (let i = 0; i < route.length - 1; i++) carveManhattan(g, route[i], route[i + 1]);
  for (const point of route) if (rand() < 0.95) carvePlaza(g, point, 1);
  for (let y = 1; y < g.length - 1; y++) for (let x = 1; x < g[0].length - 1; x++) if (g[y][x] !== 0 && rand() < 0.03) g[y][x] = 0;
}

function carveManhattan(g: Uint8Array[], from: GridPt, to: GridPt): void {
  let x = from.x;
  let y = from.y;
  const stepX = Math.sign(to.x - from.x);
  const stepY = Math.sign(to.y - from.y);
  carveCell(g, x, y);
  while (x !== to.x) { x += stepX; carveCell(g, x, y); }
  while (y !== to.y) { y += stepY; carveCell(g, x, y); }
}

function carvePlaza(g: Uint8Array[], center: GridPt, radius: number): void {
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) carveCell(g, center.x + dx, center.y + dy);
}

function carveCell(g: Uint8Array[], x: number, y: number): void {
  if (y < 0 || y >= g.length || x < 0 || x >= g[0].length) return;
  g[y][x] = 0;
}

function dedupeRoute(points: GridPt[]): GridPt[] {
  const route: GridPt[] = [];
  for (const point of points) {
    const last = route[route.length - 1];
    if (!last || last.x !== point.x || last.y !== point.y) route.push(point);
  }
  return route;
}

function clampGrid(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildRoadNetwork(mainRoute: GridPt[], width: number, height: number, rand: () => number): RoadRoute[] {
  void mainRoute;
  const midX = clampGrid(Math.floor(width * 0.5), 1, width - 2);
  const leftX = clampGrid(Math.floor(width * 0.24), 1, width - 2);
  const rightX = clampGrid(Math.floor(width * 0.74), 1, width - 2);
  const topY = clampGrid(Math.floor(height * 0.20), 1, height - 2);
  const midY = clampGrid(Math.floor(height * 0.48), 1, height - 2);
  const lowY = clampGrid(Math.floor(height * 0.74), 1, height - 2);
  const innerX = clampGrid(Math.floor(width * 0.56), 1, width - 2);
  const innerY = clampGrid(Math.floor(height * 0.34), 1, height - 2);
  const routes: RoadRoute[] = [
    { kind: 'loop', points: dedupeRoute([{ x: clampGrid(leftX - ROAD, 0, width - 1), y: topY }, { x: clampGrid(midX - ROAD, 0, width - 1), y: topY }, { x: clampGrid(midX - ROAD, 0, width - 1), y: midY }, { x: clampGrid(leftX - ROAD, 0, width - 1), y: midY }, { x: clampGrid(leftX - ROAD, 0, width - 1), y: topY }]) },
    { kind: 'loop', points: dedupeRoute([{ x: clampGrid(midX + ROAD, 0, width - 1), y: innerY }, { x: clampGrid(rightX + ROAD, 0, width - 1), y: clampGrid(innerY - 1, 0, height - 1) }, { x: clampGrid(rightX + ROAD, 0, width - 1), y: lowY }, { x: clampGrid(midX + ROAD, 0, width - 1), y: clampGrid(lowY + 1, 0, height - 1) }, { x: clampGrid(midX + ROAD, 0, width - 1), y: innerY }]) },
    { kind: 'branch', points: dedupeRoute([{ x: leftX, y: midY }, { x: midX, y: midY }, { x: midX, y: lowY }]) },
    { kind: 'branch', points: dedupeRoute([{ x: innerX, y: innerY }, { x: innerX, y: midY }, { x: rightX, y: midY }]) },
  ];
  if (rand() < 0.5) routes.push({ kind: 'branch', points: dedupeRoute([{ x: clampGrid(leftX + ROAD, 0, width - 1), y: clampGrid(topY + ROAD, 0, height - 1) }, { x: innerX, y: clampGrid(topY + ROAD, 0, height - 1) }, { x: innerX, y: innerY }]) });
  else routes.push({ kind: 'branch', points: dedupeRoute([{ x: clampGrid(rightX - ROAD, 0, width - 1), y: clampGrid(midY - ROAD, 0, height - 1) }, { x: midX, y: clampGrid(midY - ROAD, 0, height - 1) }, { x: midX, y: clampGrid(lowY - ROAD, 0, height - 1) }]) });
  return routes;
}

function buildSpawnPoints(g: Uint8Array[], roads: RoadRoute[], width: number, height: number, rand: () => number): SpawnPoints {
  const ground: GridPt[] = [];
  const air: GridPt[] = [];
  const siege: GridPt[] = [];
  const seen = new Set<string>();
  for (const road of roads) {
    for (const pt of [road.points[0], road.points[road.points.length - 1]]) {
      if (!pt) continue;
      const key = `${pt.x}:${pt.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ground.push(pt);
      siege.push(pt);
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (g[y][x] !== 0) continue;
      if (x <= 1 || y <= 1 || x >= width - 2 || y >= height - 2) {
        const pt = { x, y };
        const key = `${x}:${y}`;
        if (!seen.has(key)) {
          seen.add(key);
          ground.push(pt);
          siege.push(pt);
        }
      }
    }
  }
  for (let i = 0; i < 6; i++) air.push({ x: clampGrid(Math.floor(width * (0.15 + i * 0.12)) + (rand() < 0.5 ? 0 : 1), 0, width - 1), y: clampGrid(Math.floor(height * (0.1 + (i % 3) * 0.35)), 0, height - 1) });
  return { ground, air, siege };
}

function buildVipPath(route: GridPt[]): Array<{ x: number; z: number }> {
  const path: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < route.length - 1; i++) {
    const a = g2w(route[i].x, route[i].y);
    const b = g2w(route[i + 1].x, route[i + 1].y);
    const stepCount = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.z - a.z)) / (CS * 0.35)));
    for (let s = 0; s < stepCount; s++) {
      const t = s / stepCount;
      path.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  const last = route[route.length - 1];
  path.push(g2w(last.x, last.y));
  return path;
}

function pickAutoPieceType(wave: number, gold: number, count: number): EscortTdPieceType {
  if (wave < 2) return count % 3 === 0 || gold < 80 ? 'pawn' : 'rook';
  if (wave < 4) return count % 5 === 0 ? 'bishop' : count % 2 === 0 ? 'rook' : 'pawn';
  if (wave < 7) return count % 6 === 0 ? 'knight' : count % 4 === 0 ? 'bishop' : 'rook';
  if (gold >= 150 && count % 7 === 0) return 'queen';
  if (count % 5 === 0) return 'knight';
  return count % 2 === 0 ? 'bishop' : 'pawn';
}

function pickEnemyKind(): EscortTdEnemyKind {
  const roll = Math.random();
  if (roll < 0.52) return 'ground';
  if (roll < 0.78) return 'siege';
  return 'air';
}

function moveEnemyToward(enemy: Enemy, tx: number, tz: number, dt: number, speedMul: number): void {
  const dx = tx - enemy.x;
  const dz = tz - enemy.z;
  const len = Math.hypot(dx, dz) || 1;
  enemy.x += (dx / len) * enemy.speed * speedMul * dt;
  enemy.z += (dz / len) * enemy.speed * speedMul * dt;
}

function scoreEnemy(kind: EscortTdEnemyKind, dist2: number, mode: EscortTdCommandMode): number {
  if (mode === 'balanced') return dist2;
  const priority: Record<EscortTdEnemyKind, number> = {
    ground: mode === 'ground' ? 0 : mode === 'siege' ? 1 : 2,
    air: mode === 'air' ? 0 : mode === 'siege' ? 1 : 2,
    siege: mode === 'siege' ? 0 : mode === 'air' ? 1 : 2,
  };
  return priority[kind] * 1_000_000 + dist2;
}

function pickInterceptTarget(unit: Unit, enemies: Enemy[], kingX: number, kingZ: number): Enemy | null {
  let best: Enemy | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const guard = UNIT_GUARD[unit.type];
  for (const enemy of enemies) {
    if (enemy.dead) continue;
    const dxKing = enemy.x - kingX;
    const dzKing = enemy.z - kingZ;
    const kingDist = Math.hypot(dxKing, dzKing);
    if (kingDist > CS * 8.5) continue;
    const dxUnit = enemy.x - unit.wx;
    const dzUnit = enemy.z - unit.wz;
    const unitDist = Math.hypot(dxUnit, dzUnit);
    const score = kingDist * 0.9 + unitDist * guard.interceptBias + (enemy.kind === 'siege' ? -2 : enemy.kind === 'air' ? 1.5 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = enemy;
    }
  }
  return best;
}

function buildInterceptPoint(unit: Unit, enemy: Enemy, kingX: number, kingZ: number): { x: number; z: number } {
  const desiredDistance = Math.max(CS * 0.9, PIECE[unit.type].range * (unit.type === 'knight' ? 0.45 : unit.type === 'pawn' ? 0.7 : 0.82));
  const vx = enemy.x - kingX;
  const vz = enemy.z - kingZ;
  const len = Math.hypot(vx, vz) || 1;
  const anchorX = enemy.x - (vx / len) * desiredDistance;
  const anchorZ = enemy.z - (vz / len) * desiredDistance;
  const leash = CS * 5.2;
  const dx = anchorX - kingX;
  const dz = anchorZ - kingZ;
  const dist = Math.hypot(dx, dz);
  if (dist <= leash) return { x: anchorX, z: anchorZ };
  return { x: kingX + (dx / Math.max(dist, 0.001)) * leash, z: kingZ + (dz / Math.max(dist, 0.001)) * leash };
}

function blendAngle(current: number, target: number, t: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
