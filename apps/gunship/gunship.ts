import { encounterKindForWave, spawnWave, stepEnemies, type Enemy, type EnemyShot } from './gunship_enemies.js';
import { altitudeMargin, ceilingMargin, SEA_Y, stepPhysics, type GunshipBody } from './gunship_physics.js';
import { GunshipAgent } from './gunship_rl.js';
import { addXp, applyUpgrade, choicesFor, createRunProgress, type GunshipRunProgress, type GunshipUpgrade } from './gunship_progression.js';
import { AIRFRAMES, airframeById, configureShip, randomAirframe, twrOf, type Airframe, type AirframeId } from './gunship_airframes.js';
import { renderGunship } from './gunship_render.js';
import { comboMultiplier, createCombatState, intentLabel, registerKill, stepCombatState } from './gunship_combat.js';
import { collectOrbs, spawnOrb, stepOrbs, type XpOrb } from './gunship_pickups.js';
import { applyWeaponRecoil, weaponCooldown, weaponDamage, weaponKind, weaponProfile } from './gunship_weapons.js';
import { createGunshipEffects, emitImpact, emitKill, emitShipDamage, emitWeaponFire, stepGunshipEffects, updateCombatFeedback } from './gunship_effects.js';

const canvas = document.querySelector<HTMLCanvasElement>('#gunship');
if (!canvas) throw new Error('Missing gunship canvas');
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('Canvas 2D unavailable');
const $ = <T extends HTMLElement>(id: string): T => { const node = document.getElementById(id); if (!node) throw new Error(`Missing #${id}`); return node as T; };
const ui = { hp: $('hp'), hpText: $('hp-text'), wave: $('wave'), encounter: $('encounter'), episode: $('episode'), action: $('action'), margin: $('margin'), burst: $('burst'), kills: $('kills'), reward: $('reward'), epsilon: $('epsilon'), states: $('states'), steps: $('steps'), deaths: $('deaths'), pause: $('pause'), mode: $<HTMLSelectElement>('mode'), level: $('level'), xp: $('xp'), upgrade: $('upgrade'), choices: $('upgrade-choices'), countdown: $('upgrade-countdown'), shipAccuracy: $('ship-accuracy'), airAccuracy: $('air-accuracy'), lowMargin: $('low-margin'), noseDown: $('nose-down'), cycle: $('cycle'), survival: $('survival'), data: $('data'), researchThrust: $<HTMLButtonElement>('research-thrust'), researchHull: $<HTMLButtonElement>('research-hull'), save: $<HTMLButtonElement>('save'), resetLearning: $<HTMLButtonElement>('reset-learning'), saveStatus: $('save-status'), airframe: $<HTMLSelectElement>('airframe'), frameName: $('frame-name'), frameStats: $('frame-stats'), combo: $('combo'), recovery: $('recovery'), nextTarget: $('next-target'), weapon: $('weapon'), weaponRole: $('weapon-role') };
type MetaProgress = { data: number; thrustResearch: number; hullResearch: number };
type LiveModelBundle = { version: 1; revision: number; models: Partial<Record<AirframeId, ReturnType<GunshipAgent['serialize']>>> };
let liveModels: LiveModelBundle | null = null;
let meta: MetaProgress = { data: 0, thrustResearch: 0, hullResearch: 0 };

let selection: 'random' | AirframeId = loadSelection();
let airframe: Airframe = selection === 'random' ? randomAirframe() : airframeById(selection);
let agent = loadAgentFor(airframe.id);
let ship: GunshipBody = freshShip(); let enemies: Enemy[] = spawnWave(1, 1); let enemyShots: EnemyShot[] = []; let bullets: EnemyShot[] = []; let orbs: XpOrb[] = [];
// WAVE progression is time-based so an unbeaten battleship can't strand the run forever;
// enemies remain wave-tagged so the WAVE clear reward still lands whenever that batch dies, even late.
const WAVE_INTERVAL = 25;
const effects = createGunshipEffects();
let wave = 1; let waveTimer = WAVE_INTERVAL; const waveRewardGiven = new Set<number>(); const combat = createCombatState();
let episode = 1; let kills = 0; let fallingDeaths = 0; let episodeReward = 0; let lastReward = 0; let paused = false; let restart = 0; let nextId = 50; let previous = performance.now(); let saveTimer = 0; const run = createRunProgress(); let upgradeChoices: GunshipUpgrade[] = []; let upgradeTimer = 0; let upgradeRewardMark = 0;
let episodeElapsed = 0; let episodeMinMargin = Infinity; let noseDownSeconds = 0; let descentStarted = -1; let cycleTotal = 0; let cycleCount = 0; let shots = 0; let shipHits = 0; let airHits = 0; const survivalHistory: number[] = [];
const keys = new Set<string>();
window.addEventListener('keydown', (event) => { keys.add(event.key.toLowerCase()); if (event.key === ' ') { paused = !paused; event.preventDefault(); } });
window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
ui.pause.addEventListener('click', () => { paused = !paused; });
try { const saved = localStorage.getItem('gravity-gunship-meta-v1'); if (saved) meta = { ...meta, ...JSON.parse(saved) }; } catch { /* Meta progression is optional. */ }
ui.airframe.value = selection;
refreshAirframeOptions();
ui.airframe.addEventListener('change', () => switchAirframe(ui.airframe.value as 'random' | AirframeId));
ui.mode.addEventListener('change', () => { if (ui.mode.value === 'agent') lastReward = 0; });
ui.researchThrust.addEventListener('click', () => buyResearch('thrustResearch'));
ui.researchHull.addEventListener('click', () => buyResearch('hullResearch'));
ui.save.addEventListener('click', () => saveAgent());
ui.resetLearning.addEventListener('click', () => { if (confirm('全機種の共有学習モデルを削除して、headless学習を最初からやり直しますか？')) void resetLearning(); });
window.addEventListener('pagehide', saveAgent);
void reloadLiveModel();

function frame(now: number): void { const dt = Math.min(.033, (now - previous) / 1000); previous = now; if (!paused) update(dt); resize(); renderGunship(ctx, canvas.width, canvas.height, ship, currentAction, airframe.id, enemies, enemyShots, bullets, orbs, effects, wave); updateUi(); requestAnimationFrame(frame); }
let currentAction = agent.decide(ship, enemies, enemyShots, orbs, { weapon: weaponKind(run), recoveryDelay: combat.recoveryDelay }, 0, 0).action;
function update(dt: number): void {
  if (restart > 0) { restart -= dt; if (restart <= 0) { if (selection === 'random') randomizeRespawnAirframe(); resetTelemetry(); Object.assign(run, createRunProgress()); wave = 1; waveTimer = WAVE_INTERVAL; waveRewardGiven.clear(); Object.assign(combat, createCombatState()); Object.assign(effects, createGunshipEffects()); kills = 0; episodeReward = 0; upgradeRewardMark = 0; ship = freshShip(); enemies = spawnWave(wave, nextId); nextId += enemies.length; enemyShots = []; bullets = []; orbs = []; episode++; } return; }
  const frozen = effects.hitStop > 0; stepGunshipEffects(effects, dt); if (frozen) return;
  const manual = ui.mode.value === 'manual';
  if (run.pending > 0) { processUpgrade(dt); return; }
  const rewardStart = episodeReward;
  episodeElapsed += dt;
  const currentMargin = altitudeMargin(ship);
  episodeMinMargin = Math.min(episodeMinMargin, currentMargin);
  if (ship.angle < -.08) { noseDownSeconds += dt; if (descentStarted < 0) descentStarted = episodeElapsed; }
  else if (descentStarted >= 0) { cycleTotal += episodeElapsed - descentStarted; cycleCount++; descentStarted = -1; }
  configureShip(ship, run, airframe, meta.thrustResearch);
  currentAction = manual ? manualAction() : agent.decide(ship, enemies, enemyShots, orbs, { weapon: weaponKind(run), recoveryDelay: combat.recoveryDelay }, dt, lastReward).action;
  stepPhysics(ship, currentAction, dt);
  if (currentAction.fire && ship.fireCooldown <= 0) fireMainWeapon();
  stepEnemies(enemies, enemyShots, ship, dt); moveShots(enemyShots, dt); moveShots(bullets, dt); resolveHits(); stepCombatState(combat, ship, enemies, currentAction.fire, dt, weaponProfile(run).recoveryDelay); updateCombatFeedback(effects, combat.combo, combat.recovering);
  stepOrbs(orbs, dt);
  const collected = collectOrbs(orbs, ship.x, ship.y);
  if (collected > 0) addXp(run, collected);
  episodeReward += dt * .6;
  // Loitering at the top of frame is the reward hack the design warned about: make the ceiling a mild cost, not a refuge.
  if (ceilingMargin(ship) < 70) episodeReward -= dt * .09;
  waveTimer -= dt;
  if (waveTimer <= 0) { wave++; waveTimer = WAVE_INTERVAL; const spawned = spawnWave(wave, nextId); nextId += spawned.length; enemies.push(...spawned); }
  if (ship.y >= SEA_Y || ship.hp <= 0) finishEpisode(ship.y >= SEA_Y);
  lastReward = episodeReward - rewardStart;
  saveTimer += dt;
  if (saveTimer > 8) { saveTimer = 0; saveAgent(); }
}
// Weapon families are mutually exclusive once run.weaponFamily locks in (see gunship_progression.ts);
// the un-picked default is the baseline cannon. Each family's own upgrade re-offers as a stacking
// power-up (1.15x per stack), so picking one still has room to grow instead of a single flat unlock.
function fireMainWeapon(): void {
  switch (run.weaponFamily) {
    case 'laser': fireLaser(); break;
    case 'missile': fireMissile(); break;
    case 'flak': fireFlak(); break;
    case 'explosive': fireExplosive(); break;
    case 'railgun': fireRailgun(); break;
    default: fireCannon(); break;
  }
  applyWeaponRecoil(ship, run, airframe.recoilScale); emitWeaponFire(effects, ship, weaponKind(run));
}
function fireCannon(): void { bullets.push({ x: ship.x + Math.cos(ship.angle) * 28, y: ship.y - Math.sin(ship.angle) * 28, vx: Math.cos(ship.angle) * 610, vy: -Math.sin(ship.angle) * 610, life: 2.2, weapon: 'cannon' }); shots++; ship.fireCooldown = weaponCooldown(run); }
function fireLaser(): void { const target = enemies.find((enemy) => Math.abs(Math.atan2(-(enemy.y - ship.y), enemy.x - ship.x) - ship.angle) < .13 && Math.hypot(enemy.x - ship.x, enemy.y - ship.y) < 950); if (target) { const damage = 11 * 1.2 ** run.damage * 1.15 ** (run.laser - 1); target.hp -= damage; if (target.kind === 'battleship') episodeReward += damage * .03 * comboMultiplier(combat.combo); bullets.push({ x: target.x, y: target.y, vx: 0, vy: 0, life: .18, weapon: 'laser', originX: ship.x, originY: ship.y }); shots++; } ship.fireCooldown = weaponCooldown(run); }
function fireMissile(): void { const target = enemies.slice().sort((a, b) => Math.hypot(a.x - ship.x, a.y - ship.y) - Math.hypot(b.x - ship.x, b.y - ship.y))[0]; if (target) { const dx = target.x - ship.x; const dy = target.y - ship.y; const length = Math.max(1, Math.hypot(dx, dy)); bullets.push({ x: ship.x, y: ship.y, vx: dx / length * 300, vy: dy / length * 300, life: 3.2, weapon: 'missile' }); shots++; } ship.fireCooldown = weaponCooldown(run); }
function fireFlak(): void { const pellets = 5; for (let index = 0; index < pellets; index++) { const angle = ship.angle + (index - (pellets - 1) / 2) * .09; bullets.push({ x: ship.x + Math.cos(ship.angle) * 28, y: ship.y - Math.sin(ship.angle) * 28, vx: Math.cos(angle) * 560, vy: -Math.sin(angle) * 560, life: .35, weapon: 'flak' }); } shots++; ship.fireCooldown = weaponCooldown(run); }
function fireExplosive(): void { bullets.push({ x: ship.x + Math.cos(ship.angle) * 28, y: ship.y - Math.sin(ship.angle) * 28, vx: Math.cos(ship.angle) * 500, vy: -Math.sin(ship.angle) * 500, life: 2.4, weapon: 'explosive' }); shots++; ship.fireCooldown = weaponCooldown(run); }
function fireRailgun(): void {
  const cone = .1;
  const hits = enemies.filter((enemy) => Math.abs(Math.atan2(-(enemy.y - ship.y), enemy.x - ship.x) - ship.angle) < cone && Math.hypot(enemy.x - ship.x, enemy.y - ship.y) < 1400 && !(enemy.kind === 'submarine' && !enemy.surfaced));
  const damage = 30 * 1.2 ** run.damage * 1.15 ** (run.railgun - 1);
  for (const target of hits) { target.hp -= damage; if (target.kind === 'battleship') episodeReward += damage * .03 * comboMultiplier(combat.combo); bullets.push({ x: target.x, y: target.y, vx: 0, vy: 0, life: .15, weapon: 'railgun', originX: ship.x, originY: ship.y }); }
  shots++;
  ship.fireCooldown = weaponCooldown(run);
}
function moveShots(shots: EnemyShot[], dt: number): void { for (const shot of shots) { if (shot.weapon === 'missile') { const target = enemies.slice().sort((a, b) => Math.hypot(a.x - shot.x, a.y - shot.y) - Math.hypot(b.x - shot.x, b.y - shot.y))[0]; if (target) { const dx = target.x - shot.x; const dy = target.y - shot.y; const length = Math.max(1, Math.hypot(dx, dy)); shot.vx += (dx / length * 390 - shot.vx) * Math.min(1, dt * 4); shot.vy += (dy / length * 390 - shot.vy) * Math.min(1, dt * 4); } } shot.x += shot.vx * dt; shot.y += shot.vy * dt; shot.life -= dt; } for (let i = shots.length - 1; i >= 0; i--) if (shots[i].life <= 0) shots.splice(i, 1); }
function resolveHits(): void {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const bullet = bullets[i];
    const target = enemies.find((enemy) => Math.hypot(enemy.x - bullet.x, enemy.y - bullet.y) < enemy.radius + 4 && !(enemy.kind === 'submarine' && !enemy.surfaced));
    if (!target) continue;
    const surface = ['destroyer', 'cruiser', 'carrier', 'battleship', 'submarine'].includes(target.kind);
    if (surface) shipHits++; else airHits++;
    if (bullet.weapon !== 'laser' && bullet.weapon !== 'railgun') {
      const damage = weaponDamage(run, bullet.weapon, surface);
      target.hp -= damage;
      if (target.kind === 'battleship') episodeReward += damage * .03 * comboMultiplier(combat.combo);
    }
    const impactX = bullet.x; const impactY = bullet.y; const wasExplosive = bullet.weapon === 'explosive'; emitImpact(effects, impactX, impactY, bullet.weapon ?? 'cannon');
    bullets.splice(i, 1);
    resolveKill(target, surface);
    if (wasExplosive) {
      const splashDamage = 12 * 1.2 ** run.damage * 1.15 ** (run.explosive - 1);
      for (const other of enemies.slice()) {
        if (other === target || Math.hypot(other.x - impactX, other.y - impactY) >= 60) continue;
        other.hp -= splashDamage;
        if (other.kind === 'battleship') episodeReward += splashDamage * .03 * comboMultiplier(combat.combo);
        resolveKill(other, ['destroyer', 'cruiser', 'carrier', 'battleship', 'submarine'].includes(other.kind));
      }
    }
  }
  for (let i = enemyShots.length - 1; i >= 0; i--) if (Math.hypot(enemyShots[i].x - ship.x, enemyShots[i].y - ship.y) < 20) { ship.hp -= 10; emitShipDamage(effects, ship); enemyShots.splice(i, 1); episodeReward -= 1.5; }
}
function resolveKill(target: Enemy, surface: boolean): void {
  if (target.hp > 0) return;
  const index = enemies.indexOf(target);
  if (index < 0) return;
  emitKill(effects, target);
  enemies.splice(index, 1);
  kills++;
  const xp = target.kind === 'battleship' ? 12 : target.kind === 'carrier' ? 7 : surface ? 3 : 1;
  const killReward = target.kind === 'battleship' ? 18 : target.kind === 'carrier' ? 10 : surface ? 5 : 2;
  episodeReward += killReward * comboMultiplier(combat.combo);
  orbs.push(spawnOrb(target.x, target.y, Math.ceil(xp * comboMultiplier(combat.combo))));
  registerKill(combat);
  if (!waveRewardGiven.has(target.wave) && !enemies.some((enemy) => enemy.wave === target.wave)) { waveRewardGiven.add(target.wave); episodeReward += 8; }
}
function finishEpisode(fell: boolean): void { if (fell) fallingDeaths++; const finalReward = fell ? -16 : -9; episodeReward += finalReward; agent.finishEpisode(finalReward); meta.data += Math.max(1, Math.floor((kills + wave) / 4)); survivalHistory.push(episodeElapsed); if (survivalHistory.length > 10) survivalHistory.shift(); saveAgent(); restart = Number.POSITIVE_INFINITY; void reloadLiveModel().finally(() => { restart = 1.6; }); }
function saveAgent(): void { try { localStorage.setItem(agentKey(airframe.id), JSON.stringify(agent.serialize())); localStorage.setItem('gravity-gunship-meta-v1', JSON.stringify(meta)); ui.saveStatus.textContent = `SAVED ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`; refreshAirframeOptions(); } catch { ui.saveStatus.textContent = 'SAVE UNAVAILABLE'; } }
// Each airframe is a separately trained pilot: its Q-tables live under their own key and survive machine swaps.
function agentKey(id: AirframeId): string { return `gravity-gunship-q-${id}`; }
// Each airframe trains its own pilot, so "which of these has actually been flown"
// is otherwise invisible — and picking an untrained one looks like lost progress.
function trainingOf(id: AirframeId): { episodes: number; states: number } {
  const live = liveModels?.models?.[id];
  if (live) return { episodes: Math.max(0, live.episodes || 0), states: live.learner.qTable.length };
  try {
    const raw = localStorage.getItem(agentKey(id)) ?? (id === 'interceptor' ? localStorage.getItem('gravity-gunship-q-v1') : null);
    if (!raw) return { episodes: 0, states: 0 };
    const save = JSON.parse(raw);
    return { episodes: Math.max(0, save?.episodes || 0), states: save?.learner?.qTable?.length ?? 0 };
  } catch { return { episodes: 0, states: 0 }; }
}
function refreshAirframeOptions(): void {
  for (const option of Array.from(ui.airframe.options)) {
    if (option.value === 'random') continue;
    const frame = AIRFRAMES.find((entry) => entry.id === option.value);
    if (!frame) continue;
    const { episodes, states } = trainingOf(frame.id);
    option.textContent = episodes ? `${frame.label} · ${episodes}ep / ${states}状態` : `${frame.label} · 未訓練`;
  }
}
function loadAgentFor(id: AirframeId): GunshipAgent { const next = new GunshipAgent(); const raw = localStorage.getItem(agentKey(id)) ?? (id === 'interceptor' ? localStorage.getItem('gravity-gunship-q-v1') : null); if (raw) { try { next.restore(JSON.parse(raw)); } catch { /* Corrupt local data is optional. */ } } next.setEvaluationMode(true); return next; }
async function reloadLiveModel(): Promise<void> { try { const response = await fetch('/api/gunship/live-models', { cache: 'no-store' }); const bundle = await response.json() as LiveModelBundle; liveModels = bundle; const save = bundle.models?.[airframe.id]; if (!save) { refreshAirframeOptions(); return; } const next = new GunshipAgent(); next.restore(save); next.setEvaluationMode(true); agent = next; currentAction = agent.decide(ship, enemies, enemyShots, orbs, { weapon: weaponKind(run), recoveryDelay: combat.recoveryDelay }, 0, 0).action; ui.saveStatus.textContent = `LIVE MODEL r${bundle.revision}`; refreshAirframeOptions(); } catch { /* Keep the last complete policy. */ } }
async function resetLearning(): Promise<void> { try { const response = await fetch('/api/gunship/live-models/reset', { method: 'POST' }); if (!response.ok) throw new Error('reset rejected'); for (const frame of AIRFRAMES) localStorage.removeItem(agentKey(frame.id)); localStorage.removeItem('gravity-gunship-q-v1'); liveModels = null; agent = loadAgentFor(airframe.id); currentAction = agent.decide(ship, enemies, enemyShots, orbs, { weapon: weaponKind(run), recoveryDelay: combat.recoveryDelay }, 0, 0).action; ui.saveStatus.textContent = 'LEARNING RESET'; refreshAirframeOptions(); } catch { ui.saveStatus.textContent = 'RESET FAILED'; } }
function loadSelection(): 'random' | AirframeId { const raw = localStorage.getItem('gravity-gunship-frame-v1'); if (raw === 'random' || AIRFRAMES.some((frame) => frame.id === raw)) return raw as 'random' | AirframeId; return 'interceptor'; }
function switchAirframe(next: 'random' | AirframeId): void {
  saveAgent(); selection = next;
  try { localStorage.setItem('gravity-gunship-frame-v1', next); } catch { /* Selection persistence is optional. */ }
  airframe = next === 'random' ? randomAirframe() : airframeById(next);
  agent = loadAgentFor(airframe.id); void reloadLiveModel();
  Object.assign(run, createRunProgress());
  wave = 1; waveTimer = WAVE_INTERVAL; waveRewardGiven.clear(); Object.assign(combat, createCombatState()); Object.assign(effects, createGunshipEffects()); episode = 1; kills = 0; fallingDeaths = 0; episodeReward = 0; lastReward = 0; restart = 0; nextId = 50; upgradeChoices = []; upgradeRewardMark = 0; ui.upgrade.dataset.open = 'false';
  survivalHistory.length = 0; resetTelemetry(); ship = freshShip(); enemies = spawnWave(1, nextId); nextId += enemies.length; enemyShots = []; bullets = []; orbs = [];
}
function randomizeRespawnAirframe(): void {
  const candidates = AIRFRAMES.filter((frame) => frame.id !== airframe.id);
  airframe = candidates[Math.floor(Math.random() * candidates.length)] ?? randomAirframe();
  agent = loadAgentFor(airframe.id); void reloadLiveModel();
}
function freshShip(): GunshipBody { const maxHp = Math.round(airframe.maxHp * 1.12 ** meta.hullResearch); return { x: 1800, y: 260, vx: 0, vy: 0, angle: Math.PI / 2, hp: maxHp, maxHp, fireCooldown: 0, thrust: airframe.thrust, turn: airframe.turn, thrustTurnK: airframe.thrustTurnK, drag: airframe.drag }; }
function buyResearch(kind: 'thrustResearch' | 'hullResearch'): void { const cost = researchCost(kind); if (meta.data < cost) return; meta.data -= cost; meta[kind]++; saveAgent(); }
function researchCost(kind: 'thrustResearch' | 'hullResearch'): number { return 4 + meta[kind] * 4; }
function resetTelemetry(): void { episodeElapsed = 0; episodeMinMargin = Infinity; noseDownSeconds = 0; descentStarted = -1; cycleTotal = 0; cycleCount = 0; shots = 0; shipHits = 0; airHits = 0; }
// Level-up: a human can override within the 5s window; otherwise the RL upgrade policy commits its own learned choice.
function processUpgrade(dt: number): void { if (!upgradeChoices.length) { upgradeChoices = choicesFor(run); upgradeTimer = 5; showUpgradeChoices(); } upgradeTimer -= dt; ui.countdown.textContent = `AUTO-LEARN ${Math.max(0, upgradeTimer).toFixed(1)}s`; if (upgradeTimer <= 0) { const slot = agent.decideUpgrade({ offer: upgradeChoices.map((choice) => choice.id), level: run.level }, episodeReward - upgradeRewardMark); chooseUpgrade(upgradeChoices[Math.min(upgradeChoices.length - 1, slot)]); } }
function showUpgradeChoices(): void { ui.upgrade.dataset.open = 'true'; ui.choices.replaceChildren(...upgradeChoices.map((choice) => { const button = document.createElement('button'); button.innerHTML = `<b>${choice.label}</b><span>${choice.detail}</span>`; button.addEventListener('click', () => chooseUpgrade(choice)); return button; })); }
function chooseUpgrade(choice: GunshipUpgrade): void { applyUpgrade(run, choice); upgradeChoices = []; ui.upgrade.dataset.open = 'false'; upgradeRewardMark = episodeReward; }
function manualAction() { const turn = keys.has('a') || keys.has('arrowleft') ? 1 : keys.has('d') || keys.has('arrowright') ? -1 : 0; const thrust = keys.has('w') || keys.has('arrowup'); const fire = keys.has('f') || keys.has('enter'); return { turn: turn as -1 | 0 | 1, thrust, fire, label: 'MANUAL FLIGHT' }; }
function resize(): void { const ratio = Math.min(devicePixelRatio || 1, 2); const width = innerWidth * ratio; const height = innerHeight * ratio; if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; } }
function nextTargetLabel(): string {
  const priority = ['battleship', 'carrier', 'cruiser', 'destroyer', 'submarine', 'diver', 'mine', 'chaser'] as const;
  const target = [...enemies].filter((enemy) => enemy.kind !== 'submarine' || enemy.surfaced).sort((left, right) => priority.indexOf(left.kind) - priority.indexOf(right.kind) || Math.hypot(left.x - ship.x, left.y - ship.y) - Math.hypot(right.x - ship.x, right.y - ship.y))[0];
  return target ? target.kind.toUpperCase() : 'CLEAR SKY';
}
function updateUi(): void { const margin = altitudeMargin(ship); ui.hp.style.width = `${Math.max(0, ship.hp / ship.maxHp * 100)}%`; ui.hpText.textContent = `${Math.max(0, Math.ceil(ship.hp))} / ${ship.maxHp}`; ui.wave.textContent = String(wave); ui.encounter.textContent = encounterKindForWave(wave); ui.episode.textContent = String(episode); ui.action.textContent = intentLabel(currentAction, combat); ui.margin.textContent = `${Math.max(0, Math.round(margin))} m`; ui.burst.textContent = `${Math.max(0, Math.round(margin / Math.max(1, ship.vy + 55) * 60))} fr`; ui.kills.textContent = String(kills); ui.reward.textContent = episodeReward.toFixed(1); ui.combo.textContent = combat.combo ? `x${comboMultiplier(combat.combo).toFixed(2)} · ${combat.comboTimer.toFixed(1)}s` : '—'; ui.recovery.textContent = combat.recovering ? 'REPAIRING' : currentAction.fire ? 'FIRING' : `${combat.recoveryDelay.toFixed(1)}s`; ui.nextTarget.textContent = nextTargetLabel(); const activeWeapon = weaponProfile(run); ui.weapon.textContent = activeWeapon.label; ui.weaponRole.textContent = activeWeapon.role;  ui.epsilon.textContent = `${(agent.epsilon * 100).toFixed(1)}%`; ui.states.textContent = String(agent.knownStates); ui.steps.textContent = String(agent.steps); ui.deaths.textContent = `${fallingDeaths} / ${Math.max(1, episode - 1)}`; ui.level.textContent = String(run.level); ui.xp.textContent = `${run.xp} / ${run.nextXp}`; ui.shipAccuracy.textContent = `${Math.round(shipHits / Math.max(1, shots) * 100)}%`; ui.airAccuracy.textContent = `${Math.round(airHits / Math.max(1, shots) * 100)}%`; ui.lowMargin.textContent = `${Math.max(0, Math.round(episodeMinMargin))} m`; ui.noseDown.textContent = `${noseDownSeconds.toFixed(1)} s`; ui.cycle.textContent = cycleCount ? `${(cycleTotal / cycleCount).toFixed(1)} s` : '—'; ui.survival.textContent = survivalHistory.length ? `${(survivalHistory.reduce((sum, value) => sum + value, 0) / survivalHistory.length).toFixed(1)} s` : '—'; ui.data.textContent = String(meta.data); ui.researchThrust.textContent = `THRUST +6% · ${researchCost('thrustResearch')} DATA`; ui.researchHull.textContent = `HULL +12% · ${researchCost('hullResearch')} DATA`; ui.researchThrust.disabled = meta.data < researchCost('thrustResearch'); ui.researchHull.disabled = meta.data < researchCost('hullResearch'); ui.pause.textContent = paused ? 'RESUME' : 'PAUSE'; ui.frameName.textContent = selection === 'random' ? `RANDOM → ${airframe.label}` : airframe.label; ui.frameStats.textContent = `TWR ${twrOf(airframe).toFixed(2)} · TURN ${airframe.turn.toFixed(1)} · DRAG ${airframe.drag.toFixed(2)} · RECOIL ${airframe.recoilScale.toFixed(2)} · 通算 ${agent.episodes}ep`; }
requestAnimationFrame(frame);
