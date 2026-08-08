import { encounterKindForWave, spawnWave, type Enemy, type EnemyShot } from './gunship_enemies.js';
import { altitudeMargin, type GunshipBody } from './gunship_physics.js';
import { GunshipAgent } from './gunship_rl.js';
import { applyUpgrade, choicesFor, createRunProgress, type GunshipUpgrade } from './gunship_progression.js';
import { AIRFRAMES, airframeById, randomAirframe, twrOf, type Airframe, type AirframeId } from './gunship_airframes.js';
import { renderGunship } from './gunship_render.js';
import { comboMultiplier, intentLabel } from './gunship_combat.js';
import { type XpOrb } from './gunship_pickups.js';
import { weaponKind, weaponProfile } from './gunship_weapons.js';
import { createGunshipEffects, emitImpact, emitKill, emitShipDamage, emitWeaponFire, stepGunshipEffects, updateCombatFeedback } from './gunship_effects.js';
import { createGunshipCoreState, stepGunshipCore, type GunshipCoreState } from './gunship_core.js';
import { isCompatibleModelManifest, type ModelManifest } from '../../shared/rl/model_manifest.js';

const canvas = document.querySelector<HTMLCanvasElement>('#gunship');
if (!canvas) throw new Error('Missing gunship canvas');
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('Canvas 2D unavailable');
const $ = <T extends HTMLElement>(id: string): T => { const node = document.getElementById(id); if (!node) throw new Error(`Missing #${id}`); return node as T; };
const ui = { hp: $('hp'), hpText: $('hp-text'), wave: $('wave'), encounter: $('encounter'), episode: $('episode'), action: $('action'), margin: $('margin'), burst: $('burst'), kills: $('kills'), reward: $('reward'), epsilon: $('epsilon'), states: $('states'), steps: $('steps'), deaths: $('deaths'), pause: $('pause'), mode: $<HTMLSelectElement>('mode'), level: $('level'), xp: $('xp'), upgrade: $('upgrade'), choices: $('upgrade-choices'), countdown: $('upgrade-countdown'), shipAccuracy: $('ship-accuracy'), airAccuracy: $('air-accuracy'), lowMargin: $('low-margin'), noseDown: $('nose-down'), cycle: $('cycle'), survival: $('survival'), data: $('data'), researchThrust: $<HTMLButtonElement>('research-thrust'), researchHull: $<HTMLButtonElement>('research-hull'), save: $<HTMLButtonElement>('save'), resetLearning: $<HTMLButtonElement>('reset-learning'), saveStatus: $('save-status'), airframe: $<HTMLSelectElement>('airframe'), frameName: $('frame-name'), frameStats: $('frame-stats'), combo: $('combo'), recovery: $('recovery'), nextTarget: $('next-target'), weapon: $('weapon'), weaponRole: $('weapon-role') };
type MetaProgress = { data: number; thrustResearch: number; hullResearch: number };
type LiveModelBundle = { version: 1; revision: number; manifest?: ModelManifest; models: Partial<Record<AirframeId, ReturnType<GunshipAgent['serialize']>>> };
const liveModelCompatibility = { gameId: 'gunship', algorithm: 'tabular-q', modelVersion: 9, observationSchemaVersion: 1, rewardSchemaVersion: 1 } as const;
let liveModels: LiveModelBundle | null = null;
let meta: MetaProgress = { data: 0, thrustResearch: 0, hullResearch: 0 };

let selection: 'random' | AirframeId = loadSelection();
let airframe: Airframe = selection === 'random' ? randomAirframe() : airframeById(selection);
let agent = loadAgentFor(airframe.id);
let core: GunshipCoreState = freshCoreState();
const effects = createGunshipEffects();
let episode = 1; let kills = 0; let fallingDeaths = 0; let episodeReward = 0; let lastReward = 0; let paused = false; let restart = 0; let previous = performance.now(); let saveTimer = 0; let upgradeChoices: GunshipUpgrade[] = []; let upgradeTimer = 0; let upgradeRewardMark = 0;
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
document.documentElement.dataset.rlModelStatus = 'loading';
void reloadLiveModel().finally(() => {
  if (document.documentElement.dataset.rlModelStatus === 'loading') document.documentElement.dataset.rlModelStatus = 'fallback';
});

function frame(now: number): void { const dt = Math.min(.033, (now - previous) / 1000); previous = now; if (!paused) update(dt); resize(); renderGunship(ctx, canvas.width, canvas.height, core.ship, currentAction, airframe.id, core.enemies, core.enemyShots, core.bullets, core.orbs, effects, core.wave); updateUi(); requestAnimationFrame(frame); }
let currentAction = agent.decide(core.ship, core.enemies, core.enemyShots, core.orbs, { weapon: weaponKind(core.run), recoveryDelay: core.combat.recoveryDelay }, 0, 0).action;
function update(dt: number): void {
  if (restart > 0) { restart -= dt; if (restart <= 0) { if (selection === 'random') randomizeRespawnAirframe(); resetTelemetry(); kills = 0; episodeReward = 0; upgradeRewardMark = 0; core = freshCoreState(); Object.assign(effects, createGunshipEffects()); episode++; } return; }
  const frozen = effects.hitStop > 0; stepGunshipEffects(effects, dt); if (frozen) return;
  const manual = ui.mode.value === 'manual';
  if (core.run.pending > 0) { processUpgrade(dt); return; }
  const rewardStart = episodeReward;
  episodeElapsed += dt;
  const currentMargin = altitudeMargin(core.ship);
  episodeMinMargin = Math.min(episodeMinMargin, currentMargin);
  if (core.ship.angle < -.08) { noseDownSeconds += dt; if (descentStarted < 0) descentStarted = episodeElapsed; }
  else if (descentStarted >= 0) { cycleTotal += episodeElapsed - descentStarted; cycleCount++; descentStarted = -1; }
  currentAction = manual ? manualAction() : agent.decide(core.ship, core.enemies, core.enemyShots, core.orbs, { weapon: weaponKind(core.run), recoveryDelay: core.combat.recoveryDelay }, dt, lastReward).action;
  const result = stepGunshipCore(core, currentAction, dt, { thrustResearch: meta.thrustResearch });
  episodeReward += result.reward.total;
  kills += result.kills;
  shots += result.shots;
  shipHits += result.shipHits;
  airHits += result.airHits;
  if (result.firedWeapon) emitWeaponFire(effects, core.ship, result.firedWeapon);
  for (const impact of result.impacts) emitImpact(effects, impact.x, impact.y, impact.weapon ?? 'cannon');
  for (const killed of result.killedEnemies) emitKill(effects, killed);
  if (result.shipDamaged) emitShipDamage(effects, core.ship);
  updateCombatFeedback(effects, core.combat.combo, core.combat.recovering);
  if (result.finalReward !== null) finishEpisode(result.fell, result.finalReward);
  lastReward = result.reward.total;
  saveTimer += dt;
  if (saveTimer > 8) { saveTimer = 0; saveAgent(); }
}
function finishEpisode(fell: boolean, finalReward: number): void { if (fell) fallingDeaths++; agent.finishEpisode(finalReward); meta.data += Math.max(1, Math.floor((kills + core.wave) / 4)); survivalHistory.push(episodeElapsed); if (survivalHistory.length > 10) survivalHistory.shift(); saveAgent(); restart = Number.POSITIVE_INFINITY; void reloadLiveModel().finally(() => { restart = 1.6; }); }
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
async function reloadLiveModel(): Promise<void> { try { const response = await fetch('/api/rl/models/gunship', { cache: 'no-store' }); if (!response.ok) { document.documentElement.dataset.rlModelStatus = 'unavailable'; return; } const bundle = await response.json() as LiveModelBundle; if (bundle.manifest && !isCompatibleModelManifest(bundle.manifest, liveModelCompatibility)) { document.documentElement.dataset.rlModelStatus = 'incompatible'; return; } liveModels = bundle; const save = bundle.models?.[airframe.id]; if (!save) { document.documentElement.dataset.rlModelStatus = 'fallback'; refreshAirframeOptions(); return; } const next = new GunshipAgent(); next.restore(save); next.setEvaluationMode(true); agent = next; document.documentElement.dataset.rlModelStatus = 'compatible'; currentAction = agent.decide(core.ship, core.enemies, core.enemyShots, core.orbs, { weapon: weaponKind(core.run), recoveryDelay: core.combat.recoveryDelay }, 0, 0).action; ui.saveStatus.textContent = `INFERENCE r${bundle.revision}`; refreshAirframeOptions(); } catch { document.documentElement.dataset.rlModelStatus = 'unavailable'; /* Keep the last complete policy. */ } }
async function resetLearning(): Promise<void> { try { const response = await fetch('/api/rl/models/gunship/reset', { method: 'POST' }); if (!response.ok) throw new Error('reset rejected'); for (const frame of AIRFRAMES) localStorage.removeItem(agentKey(frame.id)); localStorage.removeItem('gravity-gunship-q-v1'); liveModels = null; agent = loadAgentFor(airframe.id); currentAction = agent.decide(core.ship, core.enemies, core.enemyShots, core.orbs, { weapon: weaponKind(core.run), recoveryDelay: core.combat.recoveryDelay }, 0, 0).action; ui.saveStatus.textContent = 'LEARNING RESET'; refreshAirframeOptions(); } catch { ui.saveStatus.textContent = 'RESET FAILED'; } }
function loadSelection(): 'random' | AirframeId { const raw = localStorage.getItem('gravity-gunship-frame-v1'); if (raw === 'random' || AIRFRAMES.some((frame) => frame.id === raw)) return raw as 'random' | AirframeId; return 'interceptor'; }
function switchAirframe(next: 'random' | AirframeId): void {
  saveAgent(); selection = next;
  try { localStorage.setItem('gravity-gunship-frame-v1', next); } catch { /* Selection persistence is optional. */ }
  airframe = next === 'random' ? randomAirframe() : airframeById(next);
  agent = loadAgentFor(airframe.id); void reloadLiveModel();
  episode = 1; kills = 0; fallingDeaths = 0; episodeReward = 0; lastReward = 0; restart = 0; upgradeChoices = []; upgradeRewardMark = 0; ui.upgrade.dataset.open = 'false';
  survivalHistory.length = 0; resetTelemetry(); core = freshCoreState(); Object.assign(effects, createGunshipEffects());
}
function randomizeRespawnAirframe(): void {
  const candidates = AIRFRAMES.filter((frame) => frame.id !== airframe.id);
  airframe = candidates[Math.floor(Math.random() * candidates.length)] ?? randomAirframe();
  agent = loadAgentFor(airframe.id); void reloadLiveModel();
}
function freshShip(): GunshipBody { const maxHp = Math.round(airframe.maxHp * 1.12 ** meta.hullResearch); return { x: 1800, y: 260, vx: 0, vy: 0, angle: Math.PI / 2, hp: maxHp, maxHp, fireCooldown: 0, thrust: airframe.thrust, turn: airframe.turn, thrustTurnK: airframe.thrustTurnK, drag: airframe.drag }; }
function freshCoreState(): GunshipCoreState { const nextId = 50; const enemies: Enemy[] = spawnWave(1, nextId); return createGunshipCoreState(freshShip(), createRunProgress(), airframe, nextId + enemies.length, enemies); }
function buyResearch(kind: 'thrustResearch' | 'hullResearch'): void { const cost = researchCost(kind); if (meta.data < cost) return; meta.data -= cost; meta[kind]++; saveAgent(); }
function researchCost(kind: 'thrustResearch' | 'hullResearch'): number { return 4 + meta[kind] * 4; }
function resetTelemetry(): void { episodeElapsed = 0; episodeMinMargin = Infinity; noseDownSeconds = 0; descentStarted = -1; cycleTotal = 0; cycleCount = 0; shots = 0; shipHits = 0; airHits = 0; }
// Level-up: a human can override within the 5s window; otherwise the RL upgrade policy commits its own learned choice.
function processUpgrade(dt: number): void { if (!upgradeChoices.length) { upgradeChoices = choicesFor(core.run); upgradeTimer = 5; showUpgradeChoices(); } upgradeTimer -= dt; ui.countdown.textContent = `AUTO-LEARN ${Math.max(0, upgradeTimer).toFixed(1)}s`; if (upgradeTimer <= 0) { const slot = agent.decideUpgrade({ offer: upgradeChoices.map((choice) => choice.id), level: core.run.level }, episodeReward - upgradeRewardMark); chooseUpgrade(upgradeChoices[Math.min(upgradeChoices.length - 1, slot)]); } }
function showUpgradeChoices(): void { ui.upgrade.dataset.open = 'true'; ui.choices.replaceChildren(...upgradeChoices.map((choice) => { const button = document.createElement('button'); button.innerHTML = `<b>${choice.label}</b><span>${choice.detail}</span>`; button.addEventListener('click', () => chooseUpgrade(choice)); return button; })); }
function chooseUpgrade(choice: GunshipUpgrade): void { applyUpgrade(core.run, choice); upgradeChoices = []; ui.upgrade.dataset.open = 'false'; upgradeRewardMark = episodeReward; }
function manualAction() { const turn = keys.has('a') || keys.has('arrowleft') ? 1 : keys.has('d') || keys.has('arrowright') ? -1 : 0; const thrust = keys.has('w') || keys.has('arrowup'); const fire = keys.has('f') || keys.has('enter'); return { turn: turn as -1 | 0 | 1, thrust, fire, label: 'MANUAL FLIGHT' }; }
function resize(): void { const ratio = Math.min(devicePixelRatio || 1, 2); const width = innerWidth * ratio; const height = innerHeight * ratio; if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; } }
function nextTargetLabel(): string {
  const priority = ['battleship', 'carrier', 'cruiser', 'destroyer', 'submarine', 'diver', 'mine', 'chaser'] as const;
  const target = [...core.enemies].filter((enemy) => enemy.kind !== 'submarine' || enemy.surfaced).sort((left, right) => priority.indexOf(left.kind) - priority.indexOf(right.kind) || Math.hypot(left.x - core.ship.x, left.y - core.ship.y) - Math.hypot(right.x - core.ship.x, right.y - core.ship.y))[0];
  return target ? target.kind.toUpperCase() : 'CLEAR SKY';
}
function updateUi(): void { const margin = altitudeMargin(core.ship); ui.hp.style.width = `${Math.max(0, core.ship.hp / core.ship.maxHp * 100)}%`; ui.hpText.textContent = `${Math.max(0, Math.ceil(core.ship.hp))} / ${core.ship.maxHp}`; ui.wave.textContent = String(core.wave); ui.encounter.textContent = encounterKindForWave(core.wave); ui.episode.textContent = String(episode); ui.action.textContent = intentLabel(currentAction, core.combat); ui.margin.textContent = `${Math.max(0, Math.round(margin))} m`; ui.burst.textContent = `${Math.max(0, Math.round(margin / Math.max(1, core.ship.vy + 55) * 60))} fr`; ui.kills.textContent = String(kills); ui.reward.textContent = episodeReward.toFixed(1); ui.combo.textContent = core.combat.combo ? `x${comboMultiplier(core.combat.combo).toFixed(2)} · ${core.combat.comboTimer.toFixed(1)}s` : '—'; ui.recovery.textContent = core.combat.recovering ? 'REPAIRING' : currentAction.fire ? 'FIRING' : `${core.combat.recoveryDelay.toFixed(1)}s`; ui.nextTarget.textContent = nextTargetLabel(); const activeWeapon = weaponProfile(core.run); ui.weapon.textContent = activeWeapon.label; ui.weaponRole.textContent = activeWeapon.role; ui.epsilon.textContent = `${(agent.epsilon * 100).toFixed(1)}%`; ui.states.textContent = String(agent.knownStates); ui.steps.textContent = String(agent.steps); ui.deaths.textContent = `${fallingDeaths} / ${Math.max(1, episode - 1)}`; ui.level.textContent = String(core.run.level); ui.xp.textContent = `${core.run.xp} / ${core.run.nextXp}`; ui.shipAccuracy.textContent = `${Math.round(shipHits / Math.max(1, shots) * 100)}%`; ui.airAccuracy.textContent = `${Math.round(airHits / Math.max(1, shots) * 100)}%`; ui.lowMargin.textContent = `${Math.max(0, Math.round(episodeMinMargin))} m`; ui.noseDown.textContent = `${noseDownSeconds.toFixed(1)} s`; ui.cycle.textContent = cycleCount ? `${(cycleTotal / cycleCount).toFixed(1)} s` : '—'; ui.survival.textContent = survivalHistory.length ? `${(survivalHistory.reduce((sum, value) => sum + value, 0) / survivalHistory.length).toFixed(1)} s` : '—'; ui.data.textContent = String(meta.data); ui.researchThrust.textContent = `THRUST +6% · ${researchCost('thrustResearch')} DATA`; ui.researchHull.textContent = `HULL +12% · ${researchCost('hullResearch')} DATA`; ui.researchThrust.disabled = meta.data < researchCost('thrustResearch'); ui.researchHull.disabled = meta.data < researchCost('hullResearch'); ui.pause.textContent = paused ? 'RESUME' : 'PAUSE'; ui.frameName.textContent = selection === 'random' ? `RANDOM → ${airframe.label}` : airframe.label; ui.frameStats.textContent = `TWR ${twrOf(airframe).toFixed(2)} · TURN ${airframe.turn.toFixed(1)} · DRAG ${airframe.drag.toFixed(2)} · RECOIL ${airframe.recoilScale.toFixed(2)} · 通算 ${agent.episodes}ep`; }
requestAnimationFrame(frame);
