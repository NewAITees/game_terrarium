import { TabularQAgent } from '../../shared/rl/tabular_q_agent.js';

// ─────────────────────────────────────────────────────────────────────────────
// One-Line RPG — RL観戦バトル
// 攻撃はコミット(予備→有効→硬直)。正しい間合い×タイミングでしか当たらない。
// AIは最初下手で、Q学習で「待つ→間合い→隙に差す」を覚えていく過程を観察する。
// ─────────────────────────────────────────────────────────────────────────────

type Action = 'idle' | 'back' | 'forward' | 'jump' | 'guard' | 'light' | 'heavy' | 'special';
type Kind = 'walker' | 'lancer' | 'spitter';
type Phase = 'startup' | 'active' | 'recovery';
type EnemyPhase = 'approach' | 'dash' | 'windup' | 'strike' | 'recover';
type Anim = { start: number; frames: number; fps: number; loop: boolean };

const actions: readonly Action[] = ['idle', 'back', 'forward', 'jump', 'guard', 'light', 'heavy', 'special'];
const labels: Record<Action, string> = {
  idle: 'WAIT', back: 'BACKSTEP', forward: 'ADVANCE', jump: 'JUMP',
  guard: 'GUARD', light: 'LIGHT', heavy: 'HEAVY', special: 'SPECIAL',
};

// ── Sprites (grids confirmed; frame ranges below are TUNABLE by eye at runtime) ──

// TUNABLE: hero animation frame ranges (100x55, row-major index = row*10+col).
const HERO: Record<string, Anim> = {
  idle: { start: 0, frames: 8, fps: 8, loop: true },
  run: { start: 10, frames: 8, fps: 12, loop: true },
  attackA: { start: 20, frames: 6, fps: 15, loop: false }, // light
  attackB: { start: 30, frames: 8, fps: 13, loop: false }, // heavy
  special: { start: 70, frames: 8, fps: 15, loop: false },
  guard: { start: 40, frames: 5, fps: 10, loop: false },
  hurt: { start: 50, frames: 3, fps: 10, loop: false },
  jump: { start: 60, frames: 4, fps: 9, loop: false },
  death: { start: 53, frames: 9, fps: 8, loop: false },
};
// TUNABLE: enemy animations. Read Me lists anims in order; idle/move sit near the end.
const ENEMY_ANIM: Record<Kind, Record<string, Anim>> = {
  walker: {
    idle: { start: 24, frames: 4, fps: 6, loop: true },
    move: { start: 30, frames: 6, fps: 12, loop: true },
    wind: { start: 6, frames: 4, fps: 10, loop: false },
    strike: { start: 10, frames: 3, fps: 12, loop: false },
    die: { start: 12, frames: 4, fps: 10, loop: false },
  },
  lancer: {
    idle: { start: 35, frames: 6, fps: 6, loop: true },
    move: { start: 42, frames: 6, fps: 10, loop: true },
    wind: { start: 7, frames: 4, fps: 9, loop: false },
    strike: { start: 11, frames: 3, fps: 12, loop: false },
    die: { start: 28, frames: 5, fps: 9, loop: false },
  },
  spitter: {
    idle: { start: 12, frames: 4, fps: 6, loop: true },
    move: { start: 18, frames: 6, fps: 10, loop: true },
    wind: { start: 18, frames: 4, fps: 8, loop: false },
    strike: { start: 22, frames: 3, fps: 12, loop: false },
    die: { start: 0, frames: 6, fps: 10, loop: false },
  },
};

// ── Combat tuning: the "flow" lives here. Attacks commit and leave 隙. ──
type AtkSpec = { anim: string; startup: number; active: number; recovery: number; range: number; dmg: number; sp: number; stam: number };
// Ranges are deliberately SHORTER than the enemies' reach, so the hero must step
// into the threat zone to attack. Safety comes only from timing (hitting an enemy's
// windup/recover), never from poking from outside. Recovery is long → mashing is punished.
const ATK: Record<'light' | 'heavy' | 'special', AtkSpec> = {
  light: { anim: 'attackA', startup: 0.12, active: 0.06, recovery: 0.28, range: 66, dmg: 1.0, sp: 0, stam: 0 },
  heavy: { anim: 'attackB', startup: 0.28, active: 0.10, recovery: 0.50, range: 96, dmg: 1.8, sp: 0, stam: 18 },
  special: { anim: 'special', startup: 0.34, active: 0.12, recovery: 0.62, range: 200, dmg: 2.6, sp: 40, stam: 0 },
};
// non-attack action commitments (startup=0)
const MOVE: Record<'idle' | 'back' | 'forward' | 'jump' | 'guard', { active: number; recovery: number }> = {
  idle: { active: 0.10, recovery: 0 },
  back: { active: 0.14, recovery: 0.05 },
  forward: { active: 0.14, recovery: 0.05 },
  jump: { active: 0.50, recovery: 0.12 },
  guard: { active: 0.28, recovery: 0.06 },
};

type EnemyDef = {
  atkRange: number; hurtRange: number; speed: number; hp: number; dmg: number;
  windup: number; strike: number; recover: number; flying: boolean; scale: number;
  // movement/attack flavor so enemies don't just walk straight in
  ranged: boolean;        // fires a projectile instead of a melee strike
  projSpeed: number;      // projectile travel speed (px/s)
  dashRange: number;      // distance at which it may burst-close (一気に近づく); 0 = never
  dashSpeed: number;      // dash burst speed
  dashTime: number;       // dash duration
  hop: number;            // vertical hop amplitude while stepping around (0 = none)
  stepEvery: number;      // seconds between little steps/feints while approaching (0 = none)
  stepBack: number;       // how far a feint step retreats
};
// Each enemy out-ranges the hero's matching attack (atkRange > light.range), so the
// hero is always in danger while attacking. Tanky + hard-hitting → blind trading loses;
// the only winning line is to strike inside the enemy's windup/recover window.
const ENEMY_DEF: Record<Kind, EnemyDef> = {
  // Rat: skittish — hops around, feints, then bursts in fast for a bite.
  walker: {
    atkRange: 70, hurtRange: 74, speed: 82, hp: 26, dmg: 14, windup: 0.34, strike: 0.12, recover: 0.44,
    flying: false, scale: 1.7, ranged: false, projSpeed: 0,
    dashRange: 190, dashSpeed: 340, dashTime: 0.28, hop: 10, stepEvery: 0.9, stepBack: 34,
  },
  // Crab: heavy — lumbers, then lunges forward with its claw during the strike.
  lancer: {
    atkRange: 116, hurtRange: 122, speed: 50, hp: 52, dmg: 24, windup: 0.6, strike: 0.16, recover: 0.62,
    flying: false, scale: 2.0, ranged: false, projSpeed: 0,
    dashRange: 150, dashSpeed: 240, dashTime: 0.3, hop: 0, stepEvery: 0, stepBack: 0,
  },
  // Skull: keeps its distance, bobs, and lobs bolts from afar.
  spitter: {
    atkRange: 300, hurtRange: 0, speed: 34, hp: 22, dmg: 13, windup: 0.7, strike: 0.18, recover: 0.7,
    flying: true, scale: 1.6, ranged: true, projSpeed: 300,
    dashRange: 0, dashSpeed: 0, dashTime: 0, hop: 14, stepEvery: 1.1, stepBack: 46,
  },
};

// Projectiles fired by ranged enemies (skull bolts).
type Projectile = { x: number; y: number; vx: number; dmg: number; dead: boolean; hit: boolean };
const projectiles: Projectile[] = [];

// ── Observation ──
type Obs = {
  distBand: number; kind: number; enemyPhase: number; selfPhase: number;
  inLight: number; inHeavy: number; hpBand: number; spBand: number; stamBand: number;
  incoming: number; // 0 none, 1 a bolt is closing in
};
const agent = new TabularQAgent<Obs, Action>({
  actions,
  learningRate: 0.18,
  discount: 0.93,
  initialEpsilon: 0.35,
  encodeState: (o) => `${o.distBand}|${o.kind}|${o.enemyPhase}|${o.selfPhase}|${o.inLight}|${o.inHeavy}|${o.hpBand}|${o.spBand}|${o.stamBand}|${o.incoming}`,
  allowedActionIndices: (o) => {
    const a = [0, 1, 2, 3, 4, 5];              // idle,back,forward,jump,guard,light
    if (o.stamBand > 0) a.push(6);             // heavy needs stamina
    if (o.spBand >= 2) a.push(7);              // special needs sp
    return a;
  },
});

// ── Upgrade agent: a second, smaller Q-learner that picks the wave-break reward. ──
// State = coarse situation; reward = combat return earned during the wave that follows,
// so it learns which upgrade actually pays off in each situation (not a fixed choice).
type UpAction = 'heal' | 'power' | 'focus';
type UpObs = { hpBand: number; spBand: number; waveBand: number };
const upActions: readonly UpAction[] = ['heal', 'power', 'focus'];
const upLabels: Record<UpAction, string> = { heal: '休息 +35HP', power: '火力 +3ATK', focus: '必殺 +40SP' };
const upgradeAgent = new TabularQAgent<UpObs, UpAction>({
  actions: upActions,
  learningRate: 0.25,
  discount: 0.85,
  initialEpsilon: 0.4,
  encodeState: (o) => `${o.hpBand}|${o.spBand}|${o.waveBand}`,
});
let waveReturn = 0;             // combat return accumulated during the current wave
let upgradePending = false;     // an upgrade choice is awaiting its next-wave reward
let upgradeBanner = '';         // "AI強化: …" text shown during the wave banner

// Per-life history for the progress trend (declared here so loadAgent can fill it).
type LifeStat = { wave: number; kills: number; dur: number };
const history: LifeStat[] = [];

// ── Persistence: the Q-table survives reloads so learning keeps accumulating. ──
// Key is versioned; bump the suffix when the state encoding / action set changes so an
// incompatible old table is ignored rather than silently poisoning the new policy.
const STORAGE_KEY = 'oneLineRpg.qtable.v1';
const UPGRADE_KEY = 'oneLineRpg.upgrade.v1';
const HISTORY_KEY = 'oneLineRpg.history.v1';
let saveTimer = 20;
let savedFlash = 0;

function loadAgent(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) agent.restore(JSON.parse(raw));
    const up = localStorage.getItem(UPGRADE_KEY);
    if (up) upgradeAgent.restore(JSON.parse(up));
    const hist = localStorage.getItem(HISTORY_KEY);
    if (hist) { const arr = JSON.parse(hist); if (Array.isArray(arr)) history.push(...arr.slice(-120)); }
  } catch { /* ignore corrupt/absent save */ }
}
function saveHistory(): void {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch { /* ignore */ }
}
function saveAgent(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(agent.serialize()));
    localStorage.setItem(UPGRADE_KEY, JSON.stringify(upgradeAgent.serialize()));
    savedFlash = 1.2;
  } catch { /* storage full or unavailable */ }
}
function resetLearning(): void {
  agent.restore({ version: 1, qTable: [], epsilon: 0.35, trainingSteps: 0 });
  upgradeAgent.restore({ version: 1, qTable: [], epsilon: 0.4, trainingSteps: 0 });
  history.length = 0;
  try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(UPGRADE_KEY); localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
}
loadAgent();
addEventListener('beforeunload', saveAgent);

// ── DOM ──
const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ctx = canvas.getContext('2d')!;
const $ = <T extends HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;
const ui = {
  wave: $('wave'), distance: $('distance'), level: $('level'), combo: $('combo'),
  hp: $('hp'), sp: $('sp'), action: $('action'), reward: $('reward'),
  epsilon: $('epsilon'), states: $('states'), telegraph: $('telegraph'),
  detail: $('telegraph-detail'), policy: $('policy'), status: $('status'),
};

// ── State ──
let W = innerWidth, H = innerHeight, groundY = H * 0.72, prev = performance.now();
let wave = 1, distance = 0, level = 1, xp = 0, nextXp = 10;
let hp = 100, sp = 100, stamina = 100, combo = 0, attack = 9;
let reward = 0, paused = false, waveBanner = 0;
let spawnTimer = 0, waveTime = 0;
let episodeReturn = 0, rewardRate = 0; // cumulative return + decaying recent-reward trace (HUD)
let killsThisLife = 0, lifeTime = 0;   // per-episode stats for the progress trend

type HeroAct = { action: Action; phase: Phase; t: number; dur: Record<Phase, number>; hitDone: boolean; exploratory: boolean };
const hero: { x: number; act: HeroAct | null; anim: string; animT: number; airborne: number; guarding: boolean; hurtT: number; dead: boolean } = {
  x: 0, act: null, anim: 'idle', animT: 0, airborne: 0, guarding: false, hurtT: 0, dead: false,
};

type Enemy = {
  x: number; y: number; hp: number; maxHp: number; kind: Kind; def: EnemyDef;
  phase: EnemyPhase; t: number; anim: string; animT: number; dead: boolean; deadT: number;
  dashT: number; stepT: number; hopT: number;
};
const enemies: Enemy[] = [];

let lastQ: readonly number[] = [];
let lastChosen = 0;
let lastExplore = false;

function resize(): void {
  W = innerWidth; H = innerHeight; groundY = H * 0.72;
  const d = Math.min(devicePixelRatio, 2);
  canvas.width = W * d; canvas.height = H * d;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  hero.x = Math.max(hero.x, W * 0.30);
}
resize();
addEventListener('resize', resize);
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'p') paused = !paused;
  if (k === 'r') { resetLearning(); ui.status.textContent = '学習をリセットしました'; }
});

function nearest(): Enemy | null {
  return enemies.filter((e) => !e.dead).sort((a, b) => Math.abs(a.x - hero.x) - Math.abs(b.x - hero.x))[0] ?? null;
}

function observe(): Obs {
  const e = nearest();
  const d = e ? e.x - hero.x : 600;
  const eph = !e ? 0
    : e.phase === 'approach' ? 0 : e.phase === 'dash' ? 1 : e.phase === 'windup' ? 2
    : e.phase === 'strike' ? 3 : 4;
  const sph = !hero.act ? 0 : hero.act.phase === 'recovery' ? 2 : 1;
  const bolt = projectiles.some((p) => !p.dead && p.x > hero.x && p.x - hero.x < 260);
  return {
    distBand: Math.min(6, Math.max(0, Math.round(d / 45))),
    kind: e ? (e.kind === 'lancer' ? 1 : e.kind === 'spitter' ? 2 : 0) : 0,
    enemyPhase: eph,
    selfPhase: sph,
    inLight: e && d > 0 && d < ATK.light.range ? 1 : 0,
    inHeavy: e && d > 0 && d < ATK.heavy.range ? 1 : 0,
    hpBand: hp < 30 ? 0 : hp < 65 ? 1 : 2,
    spBand: sp < 35 ? 0 : sp < 70 ? 1 : 2,
    stamBand: stamina < 16 ? 0 : stamina < 55 ? 1 : 2,
    incoming: bolt ? 1 : 0,
  };
}

function spawn(): void {
  const kind: Kind = wave >= 3 && Math.random() > 0.72 ? 'spitter'
    : wave >= 2 && Math.random() > 0.55 ? 'lancer' : 'walker';
  const def = ENEMY_DEF[kind];
  const hpMax = def.hp + wave * 3;
  enemies.push({
    x: W + 60, y: 0, hp: hpMax, maxHp: hpMax, kind, def,
    phase: 'approach', t: 0, anim: 'move', animT: 0, dead: false, deadT: 0,
    dashT: 0, stepT: def.stepEvery * (0.5 + Math.random()), hopT: Math.random(),
  });
}

// ── Hero action lifecycle ──
function setAnim(name: string): void { if (hero.anim !== name) { hero.anim = name; hero.animT = 0; } }

function beginAction(a: Action, exploratory: boolean): void {
  const dur: Record<Phase, number> = { startup: 0, active: 0, recovery: 0 };
  if (a === 'light' || a === 'heavy' || a === 'special') {
    const s = ATK[a];
    dur.startup = s.startup; dur.active = s.active; dur.recovery = s.recovery;
    if (a === 'special') sp = Math.max(0, sp - s.sp);
    if (a === 'heavy') stamina = Math.max(0, stamina - s.stam);
    setAnim(s.anim);
  } else {
    const m = MOVE[a];
    dur.active = m.active; dur.recovery = m.recovery;
    setAnim(a === 'jump' ? 'jump' : a === 'guard' ? 'guard' : a === 'idle' ? 'idle' : 'run');
    if (a === 'jump') hero.airborne = m.active;
  }
  hero.act = { action: a, phase: dur.startup > 0 ? 'startup' : 'active', t: 0, dur, hitDone: false, exploratory };
}

function resolveAttackHit(a: 'light' | 'heavy' | 'special'): void {
  const s = ATK[a];
  let landed = false;
  for (const e of enemies) {
    if (e.dead) continue;
    const d = e.x - hero.x;
    if (d < 0 || d > s.range) continue;
    landed = true;
    e.hp -= attack * s.dmg;
    combo++;
    // punish window bonus: hitting during enemy windup/recover is the skilled play
    const punish = e.phase === 'windup' || e.phase === 'recover' ? 0.6 : 0.15;
    reward += punish;
    if (e.hp <= 0 && !e.dead) killEnemy(e);
    if (a !== 'special') break; // single-target for light/heavy; special is AoE
  }
  if (!landed) reward -= 0.45; // whiff: full recovery for nothing
}

function killEnemy(e: Enemy): void {
  e.dead = true; e.deadT = 0; e.anim = 'die'; e.animT = 0;
  killsThisLife++;
  xp += e.kind === 'spitter' ? 3 : 2;
  distance += 12;
  reward += 2.5;
  while (xp >= nextXp) { xp -= nextXp; nextXp = Math.floor(nextXp * 1.3); level++; attack += 1; hp = Math.min(100, hp + 4); }
}

function advanceHero(dt: number): void {
  hero.animT += dt;
  hero.airborne = Math.max(0, hero.airborne - dt);
  hero.hurtT = Math.max(0, hero.hurtT - dt);
  hero.guarding = false;
  const act = hero.act;
  if (!act) { setAnim('idle'); return; }
  act.t += dt;
  const a = act.action;
  // apply movement / guard during active phase
  if (act.phase === 'active') {
    if (a === 'back') hero.x -= 170 * dt;
    if (a === 'forward') hero.x += 120 * dt;
    if (a === 'guard') { hero.guarding = true; stamina = Math.max(0, stamina - 20 * dt); }
  }
  const dur = act.dur[act.phase];
  if (act.t < dur) return;
  // phase transition
  act.t = 0;
  if (act.phase === 'startup') {
    act.phase = 'active';
    if (a === 'light' || a === 'heavy' || a === 'special') resolveAttackHit(a);
  } else if (act.phase === 'active') {
    act.phase = 'recovery';
    if (act.dur.recovery <= 0) hero.act = null;
  } else {
    hero.act = null;
  }
  hero.x = Math.max(140, Math.min(W * 0.62, hero.x));
}

// ── Enemy AI: approach (with steps/hops) → maybe dash → windup → strike/fire → recover ──
function stepEnemies(dt: number): void {
  for (const e of enemies) {
    if (e.dead) { e.deadT += dt; e.animT += dt; e.y *= 0.85; continue; }
    e.animT += dt;
    const def = e.def;
    const d = e.x - hero.x;

    // liveliness: little vertical bob/hop while active
    if (def.hop > 0) { e.hopT += dt * 6; e.y = Math.abs(Math.sin(e.hopT)) * -def.hop; }

    if (e.phase === 'approach') {
      e.anim = 'move';
      // occasional feint step: pause and hop back a little to bait the hero
      if (def.stepEvery > 0) {
        e.stepT -= dt;
        if (e.stepT <= 0 && d < def.dashRange + 60 && d > def.atkRange) {
          e.x += def.stepBack; e.stepT = def.stepEvery * (0.7 + Math.random() * 0.8);
        }
      }
      if (d > def.atkRange) {
        e.x -= def.speed * dt;
        // sudden burst-in to close the gap (一気に近づく)
        if (def.dashRange > 0 && d < def.dashRange && d > def.atkRange + 20 && Math.random() < dt * 1.1) {
          e.phase = 'dash'; e.dashT = def.dashTime; e.anim = 'move';
        }
      } else {
        e.phase = 'windup'; e.t = def.windup; e.anim = 'wind'; e.animT = 0;
      }
    } else if (e.phase === 'dash') {
      e.dashT -= dt;
      e.x -= def.dashSpeed * dt;
      if (e.dashT <= 0 || e.x - hero.x <= def.atkRange) {
        e.phase = 'windup'; e.t = def.windup; e.anim = 'wind'; e.animT = 0;
      }
    } else if (e.phase === 'windup') {
      e.t -= dt;
      if (e.t <= 0) {
        e.phase = 'strike'; e.t = def.strike; e.anim = 'strike'; e.animT = 0;
        if (def.ranged) fireProjectile(e); else resolveEnemyStrike(e);
      }
    } else if (e.phase === 'strike') {
      e.t -= dt;
      if (!def.ranged && !def.flying) e.x -= 60 * dt; // melee lunge into the blow
      if (e.t <= 0) { e.phase = 'recover'; e.t = def.recover; }
    } else {
      e.t -= dt;
      e.anim = 'idle';
      if (e.t <= 0) { e.phase = 'approach'; e.stepT = def.stepEvery; }
    }
  }
  for (let i = enemies.length - 1; i >= 0; i--) {
    if (enemies[i].dead && enemies[i].deadT > 0.55) enemies.splice(i, 1);
  }
}

function fireProjectile(e: Enemy): void {
  projectiles.push({
    x: e.x - 26, y: groundY - 46, vx: -e.def.projSpeed, dmg: e.def.dmg, dead: false, hit: false,
  });
}

function stepProjectiles(dt: number): void {
  for (const p of projectiles) {
    if (p.dead) continue;
    p.x += p.vx * dt;
    if (!p.hit && p.x <= hero.x + 22) {
      p.hit = true; p.dead = true;
      const dodgedByJump = hero.airborne > 0;            // bolts fly low → a jump clears them
      if (dodgedByJump) { reward += 0.35; continue; }
      if (hero.guarding) { hp -= p.dmg * 0.3; stamina = Math.max(0, stamina - 6); reward += 0.35; hero.hurtT = 0.12; continue; }
      const inRecovery = hero.act?.phase === 'recovery';
      hp -= p.dmg; combo = 0;
      reward -= inRecovery ? 1.5 : 1.0;
      hero.hurtT = 0.22; setAnim('hurt');
    }
    if (p.x < -40) p.dead = true;
  }
  for (let i = projectiles.length - 1; i >= 0; i--) if (projectiles[i].dead) projectiles.splice(i, 1);
}

function resolveEnemyStrike(e: Enemy): void {
  const d = e.x - hero.x;
  if (d < 0 || d > e.def.hurtRange) return; // hero slipped out of reach — good spacing
  const dodgedByJump = hero.airborne > 0 && !e.def.flying;
  if (dodgedByJump) { reward += 0.3; return; }
  if (hero.guarding) { hp -= e.def.dmg * 0.2; stamina = Math.max(0, stamina - 8); reward += 0.35; hero.hurtT = 0.12; return; }
  const inRecovery = hero.act?.phase === 'recovery';
  hp -= e.def.dmg;
  combo = 0;
  reward -= inRecovery ? 1.6 : 1.0; // getting caught mid-commit is the worst outcome
  hero.hurtT = 0.25;
  setAnim('hurt');
}

// ── Main step ──
function update(dt: number): void {
  if (paused) return;
  waveBanner = Math.max(0, waveBanner - dt);

  // 1. learning: credit the previous action for what happened last frame
  episodeReturn += reward;
  waveReturn += reward;
  rewardRate = rewardRate * 0.9 + reward; // decaying trace so HUD shows spikes, not mostly 0
  agent.observe(observe(), reward);
  reward = 0;
  savedFlash = Math.max(0, savedFlash - dt);
  saveTimer -= dt;
  if (saveTimer <= 0) { saveAgent(); saveTimer = 20; } // autosave every ~20s

  // 2. decide only when the hero is free to commit
  if (!hero.dead && !hero.act) {
    const o = observe();
    const dec = agent.decide(o);
    lastQ = agent.valuesForState(o);
    lastChosen = actions.indexOf(dec.action);
    lastExplore = dec.exploratory;
    beginAction(dec.action, dec.exploratory);
    ui.action.textContent = labels[dec.action] + (dec.exploratory ? ' *' : '');
    ui.policy.textContent = labels[dec.action];
  }

  // 3. simulate
  if (!hero.dead) lifeTime += dt;
  advanceHero(dt);
  stepEnemies(dt);
  stepProjectiles(dt);
  // regen
  stamina = Math.min(100, stamina + dt * 24);
  sp = Math.min(100, sp + dt * 5);
  waveTime += dt; spawnTimer -= dt;
  const alive = enemies.filter((e) => !e.dead).length;
  if (spawnTimer <= 0 && alive < Math.min(6, 1 + wave)) { spawnTimer = 1.6; spawn(); }

  // 4. wave / death
  if (enemies.length === 0 && waveTime > 4) {
    wave++; waveTime = 0; waveBanner = 2.4;
    chooseUpgrade();
    ui.status.textContent = 'WAVE CLEAR';
  }
  if (hp <= 0 && !hero.dead) {
    hero.dead = true; setAnim('death');
    agent.finishEpisode(-12);
    if (upgradePending) { upgradeAgent.finishEpisode(waveReturn - 6); upgradePending = false; }
    waveReturn = 0;
    history.push({ wave, kills: killsThisLife, dur: lifeTime });
    if (history.length > 120) history.shift();
    saveHistory();
    saveAgent(); // persist on death so a reload never loses a life's learning
    ui.status.textContent = 'GAME OVER · 自動再出撃 (学習継続)';
    setTimeout(respawn, 1200);
  }
}

// AI-chosen wave-break upgrade. The choice made after wave N is credited with the
// combat return earned during wave N (so good picks that help survival get reinforced).
function chooseUpgrade(): void {
  const o: UpObs = {
    hpBand: hp < 35 ? 0 : hp < 70 ? 1 : 2,
    spBand: sp < 40 ? 0 : sp < 80 ? 1 : 2,
    waveBand: Math.min(3, Math.floor((wave - 1) / 2)),
  };
  if (upgradePending) upgradeAgent.observe(o, waveReturn); // reward previous pick with the wave it produced
  waveReturn = 0;
  const dec = upgradeAgent.decide(o);
  upgradePending = true;
  if (dec.action === 'heal') hp = Math.min(100, hp + 35);
  else if (dec.action === 'power') attack += 3;
  else sp = Math.min(100, sp + 40);
  const why = dec.exploratory ? '探索' : o.hpBand === 0 && dec.action === 'heal' ? 'HP低下に対応'
    : o.spBand === 0 && dec.action === 'focus' ? '必殺を溜める' : dec.action === 'power' ? '火力で押す' : '状況判断';
  upgradeBanner = `AI強化: ${upLabels[dec.action]} (${why})`;
}

function respawn(): void {
  wave = 1; distance = 0; level = 1; xp = 0; nextXp = 10;
  hp = 100; sp = 100; stamina = 100; combo = 0; attack = 9;
  episodeReturn = 0; rewardRate = 0; waveReturn = 0; upgradePending = false; upgradeBanner = '';
  killsThisLife = 0; lifeTime = 0;
  enemies.length = 0; projectiles.length = 0; hero.dead = false; hero.act = null; setAnim('idle');
  ui.status.textContent = 'AI操作 · オンライン学習中';
}

// ── Rendering ──
function drawEnemyVector(e: Enemy, ground: number): void {
  const color = e.kind === 'lancer' ? '#ff9e67' : e.kind === 'spitter' ? '#ca81ff' : '#71dd9c';
  ctx.save(); ctx.translate(e.x, ground); ctx.fillStyle = color; ctx.strokeStyle = '#182134'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(-18, -34); ctx.lineTo(0, -45); ctx.lineTo(18, -34); ctx.lineTo(22, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#182134'; ctx.fillRect(-11, -28, 6, 6); ctx.fillRect(5, -28, 6, 6); ctx.restore();
}
function drawHeroVector(cx: number, ground: number): void {
  ctx.save(); ctx.translate(cx, ground); ctx.fillStyle = '#eaf6ff'; ctx.strokeStyle = '#83e7ff'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, -54, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.roundRect(-15, -42, 30, 34, 8); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-8, -8); ctx.lineTo(-16, 0); ctx.moveTo(8, -8); ctx.lineTo(16, 0); ctx.moveTo(-12, -35); ctx.lineTo(-29, -21); ctx.moveTo(12, -35); ctx.lineTo(29, -21); ctx.stroke(); ctx.restore();
}
function draw(): void {
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, '#151c31'); sky.addColorStop(1, '#31465a');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  // ground band
  const g = ctx.createLinearGradient(0, groundY, 0, H);
  g.addColorStop(0, '#3c4a30'); g.addColorStop(1, '#1c2417');
  ctx.fillStyle = g; ctx.fillRect(0, groundY, W, H - groundY);
  ctx.strokeStyle = '#6b7f4e'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(W, groundY); ctx.stroke();

  drawSpacingGuides();
  drawEnemyTelegraphs();

  // enemies (behind hero when to the right is fine; draw all then hero)
  for (const e of enemies) {
    const anim = ENEMY_ANIM[e.kind][e.anim] ?? ENEMY_ANIM[e.kind].idle;
    const yOff = (e.def.flying ? -46 : 0) + e.y;
    if (e.phase === 'dash' && !e.dead) drawDashStreak(e);
    if (e.dead) ctx.globalAlpha = Math.max(0, 1 - e.deadT / 0.55);
    drawEnemyVector(e, groundY + yOff);
    ctx.globalAlpha = 1;
    if (!e.dead) drawHpBar(e);
  }

  drawProjectiles();
  drawHeroAttackRange();

  // hero
  const ha = HERO[hero.anim] ?? HERO.idle;
  const y = groundY - hero.airborne * 90;
  if (hero.hurtT > 0) ctx.globalAlpha = 0.6 + 0.4 * Math.sin(performance.now() * 0.05);
  drawHeroVector(hero.x, y);
  ctx.globalAlpha = 1;

  drawQPanel();
  drawTrend();
  if (waveBanner > 0) drawBanner();
}

// Progress trend: each death is one point. As the two AIs learn, wave-reached and kills
// should drift upward — this is the "see it get better over time" view the series is about.
function drawTrend(): void {
  const w = 232, h = 96, x = W - w - 14, y = H - h - 14;
  ctx.save();
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(10,14,26,.82)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#2b3a5c'; ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.fillStyle = '#a7ffcf';
  ctx.fillText('上達トレンド — 到達WAVE / 撃破', x + 8, y + 14);

  const pad = 8, gx = x + pad, gw = w - pad * 2, gTop = y + 22, gBot = y + h - 16, gh = gBot - gTop;
  if (history.length < 2) {
    ctx.fillStyle = '#5c6f92';
    ctx.fillText('データ収集中… (死ぬたびに記録)', gx, gTop + 24);
    ctx.restore();
    return;
  }
  const recent = history.slice(-60);
  const maxWave = Math.max(3, ...recent.map((s) => s.wave));
  const maxKills = Math.max(5, ...recent.map((s) => s.kills));
  const px = (i: number) => gx + (recent.length === 1 ? 0 : (i / (recent.length - 1)) * gw);

  // kills line (faint)
  ctx.strokeStyle = 'rgba(255,180,120,.55)'; ctx.lineWidth = 1;
  ctx.beginPath();
  recent.forEach((s, i) => { const yy = gBot - (s.kills / maxKills) * gh; i ? ctx.lineTo(px(i), yy) : ctx.moveTo(px(i), yy); });
  ctx.stroke();

  // wave line (primary)
  ctx.strokeStyle = '#6fd3ff'; ctx.lineWidth = 2;
  ctx.beginPath();
  recent.forEach((s, i) => { const yy = gBot - (s.wave / maxWave) * gh; i ? ctx.lineTo(px(i), yy) : ctx.moveTo(px(i), yy); });
  ctx.stroke();

  // moving average of wave (trend, dashed)
  ctx.strokeStyle = 'rgba(255,227,154,.85)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5;
  ctx.beginPath();
  const k = 6;
  recent.forEach((_, i) => {
    const a = Math.max(0, i - k + 1);
    const avg = recent.slice(a, i + 1).reduce((s, r) => s + r.wave, 0) / (i - a + 1);
    const yy = gBot - (avg / maxWave) * gh; i ? ctx.lineTo(px(i), yy) : ctx.moveTo(px(i), yy);
  });
  ctx.stroke(); ctx.setLineDash([]);

  const best = Math.max(...history.map((s) => s.wave));
  ctx.fillStyle = '#8fa4c7';
  ctx.fillText(`lives ${history.length}  best W${best}  now W${wave}`, gx, gBot + 12);
  ctx.restore();
}

function drawSpacingGuides(): void {
  // faint reach markers so the observer can read the hero's spacing
  ctx.save();
  ctx.setLineDash([4, 6]); ctx.lineWidth = 1;
  for (const [range, color] of [[ATK.light.range, 'rgba(131,231,255,.28)'], [ATK.heavy.range, 'rgba(255,227,154,.22)']] as const) {
    ctx.strokeStyle = color;
    ctx.beginPath(); ctx.moveTo(hero.x + range, groundY - 60); ctx.lineTo(hero.x + range, groundY + 6); ctx.stroke();
  }
  ctx.restore();
}

function drawHeroAttackRange(): void {
  const act = hero.act;
  if (!act || (act.action !== 'light' && act.action !== 'heavy' && act.action !== 'special')) return;
  const s = ATK[act.action];
  const active = act.phase === 'active';
  const startup = act.phase === 'startup';
  if (!active && !startup) return;
  ctx.save();
  ctx.fillStyle = active ? 'rgba(120,240,255,.32)' : 'rgba(255,220,120,.16)';
  ctx.strokeStyle = active ? 'rgba(150,250,255,.9)' : 'rgba(255,220,120,.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(hero.x, groundY - 30);
  ctx.arc(hero.x, groundY - 30, s.range, -0.6, 0.6);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawEnemyTelegraphs(): void {
  for (const e of enemies) {
    if (e.dead) continue;
    if (e.phase === 'windup') {
      const p = 1 - e.t / e.def.windup;
      ctx.save();
      if (e.def.ranged) {
        // charging a bolt: growing orb + an aim line toward the hero
        const cx = e.x - 24, cy = groundY - 46 + e.y;
        ctx.strokeStyle = 'rgba(202,129,255,.35)'; ctx.lineWidth = 2;
        ctx.setLineDash([4, 6]);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(hero.x, groundY - 46); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = `rgba(202,129,255,${0.4 + p * 0.5})`;
        ctx.beginPath(); ctx.arc(cx, cy, 4 + p * 10, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(255,99,125,.85)'; ctx.lineWidth = 3;
        ctx.fillStyle = `rgba(255,70,90,${0.10 + p * 0.14})`;
        ctx.beginPath();
        ctx.moveTo(e.x, groundY - 26);
        ctx.arc(e.x, groundY - 26, e.def.hurtRange, Math.PI - 0.6, Math.PI + 0.6);
        ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.arc(e.x, groundY - 40, 16, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    } else if (e.phase === 'strike' && !e.def.ranged) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,60,80,.4)';
      ctx.beginPath(); ctx.arc(e.x, groundY - 26, e.def.hurtRange, Math.PI - 0.6, Math.PI + 0.6); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
}

function drawDashStreak(e: Enemy): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,180,120,.5)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(e.x + 40, groundY - 26 + e.y); ctx.lineTo(e.x + 120, groundY - 26 + e.y); ctx.stroke();
  ctx.restore();
}

function drawProjectiles(): void {
  for (const p of projectiles) {
    if (p.dead) continue;
    ctx.save();
    ctx.fillStyle = 'rgba(202,129,255,.95)';
    ctx.shadowColor = '#ca81ff'; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(230,200,255,.55)';
    ctx.beginPath(); ctx.arc(p.x + 12, p.y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function drawHpBar(e: Enemy): void {
  const w = 42, h = 5, x = e.x - w / 2, y = groundY - e.def.scale * 64 - 8;
  ctx.fillStyle = '#0008'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = e.phase === 'recover' ? '#8fffb0' : '#ff7a86';
  ctx.fillRect(x, y, w * Math.max(0, e.hp / e.maxHp), h);
}

function drawQPanel(): void {
  if (!lastQ.length) return;
  const x = 16, y = H - 150, bw = 150, bh = 12, gap = 3;
  ctx.save();
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(10,14,26,.8)';
  ctx.fillRect(x - 8, y - 20, bw + 70, actions.length * (bh + gap) + 26);
  ctx.fillStyle = '#a7ffcf';
  ctx.fillText('Q-VALUES (policy)', x, y - 8);
  ctx.fillStyle = episodeReturn >= 0 ? '#8fffb0' : '#ff9daa';
  ctx.fillText(`RETURN ${episodeReturn >= 0 ? '+' : ''}${episodeReturn.toFixed(1)}`, x + 118, y - 8);
  ctx.fillStyle = savedFlash > 0 ? '#ffe39a' : '#5c6f92';
  ctx.fillText(`steps ${agent.trainingSteps}${savedFlash > 0 ? ' 💾saved' : ''}`, x, y + actions.length * (bh + gap) + 2);
  const max = Math.max(0.01, ...lastQ.map((v) => Math.abs(v)));
  actions.forEach((a, i) => {
    const yy = y + i * (bh + gap);
    const v = lastQ[i] ?? 0;
    const len = (Math.abs(v) / max) * bw;
    const chosen = i === lastChosen;
    ctx.fillStyle = chosen ? (lastExplore ? '#ffd45e' : '#6fd3ff') : v >= 0 ? '#3a6a8a' : '#7a3a4a';
    ctx.fillRect(x + 44, yy, len, bh);
    ctx.fillStyle = chosen ? '#fff' : '#8fa4c7';
    ctx.fillText(labels[a], x, yy + bh - 2);
    ctx.fillText(v.toFixed(2), x + 46 + bw + 4, yy + bh - 2);
  });
  ctx.restore();
}

function drawBanner(): void {
  ctx.save();
  ctx.globalAlpha = Math.min(1, waveBanner);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#83e7ff'; ctx.font = 'bold 34px ui-monospace, monospace';
  ctx.fillText(`WAVE ${wave}`, W / 2, H * 0.3);
  if (upgradeBanner) {
    ctx.fillStyle = '#ffe39a'; ctx.font = '15px ui-monospace, monospace';
    ctx.fillText(upgradeBanner, W / 2, H * 0.3 + 28);
  }
  ctx.restore();
}

function hud(): void {
  const e = nearest();
  ui.wave.textContent = '' + wave;
  ui.distance.textContent = Math.floor(distance) + 'm';
  ui.level.textContent = '' + level;
  ui.combo.textContent = '' + combo;
  ui.hp.textContent = '' + Math.max(0, Math.round(hp));
  ui.sp.textContent = '' + Math.round(sp);
  ui.reward.textContent = (rewardRate >= 0 ? '+' : '') + rewardRate.toFixed(2);
  ui.epsilon.textContent = (agent.epsilon * 100).toFixed(1) + '%';
  ui.states.textContent = '' + agent.knownStates;
  const ph = e ? (e.phase === 'windup' ? '⚠ WINDUP' : e.phase === 'dash' ? '»» DASH' : e.phase === 'strike' ? '✸ STRIKE' : e.phase === 'recover' ? '○ 隙(反撃可)' : 'APPROACH') : 'NONE';
  ui.telegraph.textContent = ph;
  ui.detail.textContent = e ? `${e.kind.toUpperCase()} · ${Math.round(Math.abs(e.x - hero.x))}px` : '敵を待機中';
}

function frame(now: number): void {
  const dt = Math.min(0.04, (now - prev) / 1000);
  prev = now;
  update(dt);
  draw();
  hud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
