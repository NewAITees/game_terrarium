import { QLearningAgent } from './arena_shooter_agent.js';
import {
  createArenaState,
  craftLabel,
  getArenaCamera,
  observeArena,
  prepareArenaWave,
  resetEpisode,
  resizeArena,
  setCraftPreference,
  stepArena,
  type ArenaObservation,
  type CraftPreference,
} from './arena_shooter_core.js';
import {
  DEFAULT_META,
  addKillProgress,
  ascend,
  ascensionPower,
  applyUpgrade,
  buyResearch,
  canAscend,
  collectEpisode,
  createRunProgress,
  formatIncremental,
  getUpgradeChoices,
  researchCost,
  type ArenaMetaProgress,
  type ArenaRunProgress,
  type UpgradeChoice,
} from './arena_shooter_progression.js';
import { loadArenaSave, saveArenaState } from './arena_shooter_save.js';
import { renderArena } from './arena_shooter_render.js';

const canvas = requireElement<HTMLCanvasElement>('arena');
const context = canvas.getContext('2d');
if (!context) throw new Error('Canvas 2D context is unavailable');

const loaded = await loadArenaSave();
const state = createArenaState(1600, 900);
const craftPreference = loadCraftPreference();
setCraftPreference(state, craftPreference);
const agent = new QLearningAgent();
agent.setEvaluationMode(true);
// The visible ship only ever plays back the latest synced policy; all learning
// happens in backgroundAgent below so the two can never fall out of process sync.
const backgroundAgent = new QLearningAgent();
const backgroundState = createArenaState(960, 540);
setCraftPreference(backgroundState, 'random');
let backgroundRun = createRunProgress();
let backgroundReward = 0;
let syncTimer = 0;
const BACKGROUND_STEP_BUDGET_MS = 6;
const SYNC_INTERVAL_SECONDS = 2;
let meta: ArenaMetaProgress = {
  ...DEFAULT_META,
  data: loaded?.data ?? DEFAULT_META.data,
  damageResearch: loaded?.damageResearch ?? DEFAULT_META.damageResearch,
  hullResearch: loaded?.hullResearch ?? DEFAULT_META.hullResearch,
};
let run: ArenaRunProgress = createRunProgress();
let previousTime = performance.now();
let accumulatedReward = 0;
let paused = false;
let saveTimer = 0;
let upgradeTimer = 0;
let upgradeChoices: UpgradeChoice[] = [];
let upgradeSelection: UpgradeChoice | null = null;
let bannerTimer = loaded ? 3 : 0;

const ui = {
  hpFill: requireElement<HTMLElement>('hp-fill'),
  hpText: requireElement<HTMLElement>('hp-text'),
  score: requireElement<HTMLElement>('score'),
  kills: requireElement<HTMLElement>('kills'),
  wave: requireElement<HTMLElement>('wave'),
  waveProgress: requireElement<HTMLElement>('wave-progress-fill'),
  cycle: requireElement<HTMLElement>('cycle'),
  episode: requireElement<HTMLElement>('episode'),
  level: requireElement<HTMLElement>('level'),
  xp: requireElement<HTMLElement>('xp'),
  scrap: requireElement<HTMLElement>('scrap'),
  scrapConversion: requireElement<HTMLElement>('scrap-conversion'),
  data: requireElement<HTMLElement>('data'),
  ascendium: requireElement<HTMLElement>('ascendium'),
  action: requireElement<HTMLElement>('action'),
  policyMode: requireElement<HTMLElement>('policy-mode'),
  agentStatus: requireElement<HTMLElement>('agent-status'),
  reward: requireElement<HTMLElement>('reward'),
  epsilon: requireElement<HTMLElement>('epsilon'),
  states: requireElement<HTMLElement>('states'),
  steps: requireElement<HTMLElement>('steps'),
  edgeObservation: requireElement<HTMLElement>('edge-observation'),
  motionObservation: requireElement<HTMLElement>('motion-observation'),
  episodeReward: requireElement<HTMLElement>('episode-reward'),
  best: requireElement<HTMLElement>('best'),
  weaponPulse: requireElement<HTMLElement>('weapon-pulse'),
  weaponRate: requireElement<HTMLElement>('weapon-rate'),
  weaponProjectiles: requireElement<HTMLElement>('weapon-projectiles'),
  weaponVelocity: requireElement<HTMLElement>('weapon-velocity'),
  weaponIntercept: requireElement<HTMLElement>('weapon-intercept'),
  weaponTurret: requireElement<HTMLElement>('weapon-turret'),
  weaponMissile: requireElement<HTMLElement>('weapon-missile'),
  weaponNova: requireElement<HTMLElement>('weapon-nova'),
  weaponLaser: requireElement<HTMLElement>('weapon-laser'),
  weaponRicochet: requireElement<HTMLElement>('weapon-ricochet'),
  weaponTrail: requireElement<HTMLElement>('weapon-trail'),
  lastUpgrade: requireElement<HTMLElement>('last-upgrade'),
  upgradePanel: requireElement<HTMLElement>('upgrade-panel'),
  upgradeButtons: requireElement<HTMLElement>('upgrade-buttons'),
  upgradeCountdown: requireElement<HTMLElement>('upgrade-countdown'),
  banner: requireElement<HTMLElement>('banner'),
  damageResearch: requireElement<HTMLButtonElement>('research-damage'),
  hullResearch: requireElement<HTMLButtonElement>('research-hull'),
  damageResearchEffect: requireElement<HTMLElement>('research-damage-effect'),
  hullResearchEffect: requireElement<HTMLElement>('research-hull-effect'),
  ascend: requireElement<HTMLButtonElement>('ascend'),
  pause: requireElement<HTMLButtonElement>('pause'),
  mode: requireElement<HTMLElement>('runtime-mode'),
  craft: requireElement<HTMLElement>('craft'),
  craftSelect: requireElement<HTMLSelectElement>('craft-select'),
};
ui.craftSelect.value = craftPreference;
ui.mode.textContent = 'LIVE EVOLUTION';
ui.mode.dataset.training = 'false';
ui.agentStatus.textContent = 'BG TRAINING STARTING';

function resize(): void {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(window.innerWidth * ratio);
  canvas.height = Math.round(window.innerHeight * ratio);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  resizeArena(state, window.innerWidth, window.innerHeight);
}

function frame(now: number): void {
  const dt = Math.min(0.033, (now - previousTime) / 1000);
  previousTime = now;
  configureShipFromProgress();
  const observation = observeArena(state);
  const decision = agent.decide(observation, dt, accumulatedReward);
  accumulatedReward = 0;

  if (!paused) {
    const result = stepArena(state, decision.action, dt);
    accumulatedReward = result.reward;
    for (const value of result.killedValues) addKillProgress(run, value, state.wave);
    if (result.waveAdvanced) {
      meta.highestWave = Math.max(meta.highestWave, state.wave);
      showBanner(state.wave % 5 === 0 ? `TRIAL WAVE ${state.wave}` : `WAVE ${state.wave}`);
      persist();
    }
    processUpgrade(dt);
    if (state.ship.hp <= 0) finishEpisode();
    saveTimer += dt;
    if (saveTimer >= 30) {
      saveTimer = 0;
      persist();
    }
  }

  runBackgroundTraining();
  syncTimer += dt;
  if (syncTimer >= SYNC_INTERVAL_SECONDS) {
    syncTimer = 0;
    agent.restore(backgroundAgent.serialize());
    ui.agentStatus.textContent = `BG TRAINED · ${backgroundAgent.trainingSteps.toLocaleString()} steps`;
  }

  bannerTimer -= dt;
  ui.banner.dataset.open = String(bannerTimer > 0);
  renderArena(context, state, observation, decision);
  updateHud(decision.action.label, decision.exploratory, observation);
  updatePanelOcclusion();
  requestAnimationFrame(frame);
}

// Runs many unrendered episodes on a separate arena instance within the same
// process/tick, time-boxed so it never starves the visible frame. This is what
// keeps training running for as long as the app is open, with no separate
// process to start, forget, or fall out of sync with what's on screen.
function runBackgroundTraining(): void {
  const deadline = performance.now() + BACKGROUND_STEP_BUDGET_MS;
  while (performance.now() < deadline) {
    const observation = observeArena(backgroundState);
    const decision = backgroundAgent.decide(observation, 1 / 60, backgroundReward);
    const result = stepArena(backgroundState, decision.action, 1 / 60);
    backgroundReward = result.reward;
    for (const value of result.killedValues) addKillProgress(backgroundRun, value, backgroundState.wave);
    while (backgroundRun.pendingUpgrades > 0) {
      applyUpgrade(backgroundRun, getUpgradeChoices(backgroundRun, backgroundState.ship.craftType)[0], () => {
        backgroundState.ship.hp = backgroundState.ship.maxHp;
      });
    }
    backgroundState.pulseLevel = backgroundRun.weapons.pulse;
    backgroundState.fireRateLevel = backgroundRun.fireRateLevel;
    backgroundState.projectileCountLevel = backgroundRun.projectileCountLevel;
    backgroundState.projectileSpeedLevel = backgroundRun.projectileSpeedLevel;
    backgroundState.projectileInterceptLevel = backgroundRun.projectileInterceptLevel;
    backgroundState.turretTurnLevel = backgroundRun.turretTurnLevel;
    backgroundState.missileLevel = backgroundRun.weapons.missile;
    backgroundState.novaLevel = backgroundRun.weapons.nova;
    backgroundState.laserLevel = backgroundRun.weapons.laser;
    backgroundState.ricochetLevel = backgroundRun.weapons.ricochet;
    backgroundState.trailLevel = backgroundRun.weapons.trail;
    if (backgroundState.ship.hp <= 0) {
      backgroundAgent.finishEpisode(backgroundReward - 12);
      backgroundRun = createRunProgress();
      resetEpisode(backgroundState);
      backgroundReward = 0;
    }
  }
}

function configureShipFromProgress(): void {
  state.pulseLevel = run.weapons.pulse;
  state.fireRateLevel = run.fireRateLevel;
  state.projectileCountLevel = run.projectileCountLevel;
  state.projectileSpeedLevel = run.projectileSpeedLevel;
  state.projectileInterceptLevel = run.projectileInterceptLevel;
  state.turretTurnLevel = run.turretTurnLevel;
  state.missileLevel = run.weapons.missile;
  state.novaLevel = run.weapons.nova;
  state.laserLevel = run.weapons.laser;
  state.ricochetLevel = run.weapons.ricochet;
  state.trailLevel = run.weapons.trail;
  state.damageMultiplier = 1.18 ** meta.damageResearch * ascensionPower(meta);
  const maxHp = Math.round(100 * 1.2 ** meta.hullResearch);
  if (state.ship.maxHp !== maxHp) {
    const ratio = state.ship.hp / state.ship.maxHp;
    state.ship.maxHp = maxHp;
    state.ship.hp = Math.max(1, Math.round(maxHp * ratio));
  }
}

function processUpgrade(dt: number): void {
  if (run.pendingUpgrades <= 0) {
    ui.upgradePanel.dataset.open = 'false';
    upgradeChoices = [];
    upgradeSelection = null;
    return;
  }
  if (!upgradeChoices.length) {
    upgradeChoices = getUpgradeChoices(run, state.ship.craftType);
    upgradeSelection = null;
    upgradeTimer = 3;
    renderUpgradeChoices();
  }
  upgradeTimer -= dt;
  ui.upgradeCountdown.textContent = `HUMAN WINDOW ${Math.max(0, upgradeTimer).toFixed(1)}s`;
  if (upgradeTimer <= 0 && !upgradeSelection) {
    const selection = agent.chooseUpgrade(state.ship.craftType, upgradeChoices, state.wave);
    upgradeSelection = selection.choice;
    chooseUpgrade(upgradeSelection);
  }
}

function renderUpgradeChoices(): void {
  ui.upgradePanel.dataset.open = 'true';
  ui.upgradeButtons.replaceChildren();
  for (const choice of upgradeChoices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = `<b>${choice.label}</b><span>${choice.description}</span>`;
    button.disabled = false;
    button.dataset.selected = String(choice === upgradeSelection);
    button.addEventListener('click', () => chooseUpgrade(choice));
    ui.upgradeButtons.append(button);
  }
}

function chooseUpgrade(choice: UpgradeChoice): void {
  if (!upgradeChoices.includes(choice)) return;
  upgradeChoices = [];
  upgradeSelection = null;
  applyUpgrade(run, choice, () => {
    state.ship.hp = Math.min(state.ship.maxHp, state.ship.hp + state.ship.maxHp * 0.3);
  });
  showBanner(choice.label);
  persist();
}

function finishEpisode(): void {
  accumulatedReward -= 12;
  agent.finishEpisode(accumulatedReward);
  const earned = collectEpisode(meta, run, state.wave, state.kills);
  showBanner(`RUN COMPLETE  +${earned} DATA`, 4);
  run = createRunProgress();
  resetEpisode(state);
  configureShipFromProgress();
  state.ship.hp = state.ship.maxHp;
  persist();
}

function persist(): void {
  void saveArenaState({
    schemaVersion: 2,
    updatedAt: new Date().toISOString(),
    data: meta.data,
    damageResearch: meta.damageResearch,
    hullResearch: meta.hullResearch,
  }).catch((error) => {
    console.warn('Permanent progress remains in local storage; server save failed.', error);
  });
}

function showBanner(message: string, duration = 2): void {
  ui.banner.textContent = message;
  bannerTimer = duration;
  ui.banner.dataset.open = 'true';
}

function updateHud(actionLabel: string, exploratory: boolean, observation: ArenaObservation): void {
  const hpRatio = Math.max(0, state.ship.hp / state.ship.maxHp);
  ui.hpFill.style.width = `${hpRatio * 100}%`;
  ui.hpFill.dataset.level = hpRatio < 0.35 ? 'danger' : hpRatio < 0.65 ? 'warn' : 'safe';
  ui.hpText.textContent = `${Math.max(0, Math.ceil(state.ship.hp))} / ${state.ship.maxHp}`;
  ui.score.textContent = formatIncremental(state.score);
  ui.kills.textContent = formatIncremental(state.kills);
  ui.wave.textContent = String(state.wave);
  const defeatedThisWave = Math.max(0, state.waveSpawned - state.enemies.length);
  ui.waveProgress.style.width = `${defeatedThisWave / state.waveTotal * 100}%`;
  ui.cycle.textContent = `${(state.wave - 1) % 5 + 1}/5`;
  ui.craft.textContent = craftLabel(state.ship.craftType);
  ui.episode.textContent = String(state.episode);
  ui.level.textContent = String(run.level);
  ui.xp.textContent = `${formatIncremental(run.xp)} / ${formatIncremental(run.nextLevelXp)}`;
  ui.scrap.textContent = formatIncremental(run.scrap);
  ui.scrapConversion.textContent = `+${formatIncremental(Math.floor(run.scrap * 0.02))} DATA`;
  ui.data.textContent = formatIncremental(meta.data);
  ui.ascendium.textContent = formatIncremental(meta.ascendium);
  ui.action.textContent = actionLabel;
  ui.policyMode.textContent = exploratory ? '探索' : '活用';
  ui.policyMode.dataset.explore = String(exploratory);
  ui.reward.textContent = signed(state.lastReward);
  ui.epsilon.textContent = `${(agent.epsilon * 100).toFixed(1)}%`;
  ui.states.textContent = agent.knownStates.toLocaleString();
  ui.steps.textContent = agent.trainingSteps.toLocaleString();
  const directionLabels = ['前', '右前', '右', '右後', '後', '左後', '左', '左前'];
  const edgeBands = ['NEAR', 'MID', 'FAR'];
  const speedBands = ['STOP/SLOW', 'CRUISE', 'FAST'];
  ui.edgeObservation.textContent = `${directionLabels[observation.edgeSector]} ${edgeBands[observation.edgeDistanceBand]}`;
  ui.motionObservation.textContent = `${directionLabels[observation.velocitySector]} ${speedBands[observation.speedBand]}`;
  ui.episodeReward.textContent = signed(state.episodeReward);
  ui.best.textContent = String(meta.highestWave);
  ui.weaponPulse.textContent = `Mk.${run.weapons.pulse}`;
  ui.weaponRate.textContent = `Lv.${run.fireRateLevel}`;
  const pulseCount = Math.min(5, 1 + Math.floor((run.projectileCountLevel + 1) / 2));
  ui.weaponProjectiles.textContent = `Lv.${run.projectileCountLevel} · ${pulseCount} ${pulseCount % 2 ? 'ODD' : 'EVEN'}`;
  ui.weaponVelocity.textContent = `Lv.${run.projectileSpeedLevel}`;
  ui.weaponIntercept.textContent = 'STANDARD · ACTIVE';
  ui.weaponTurret.textContent = `Lv.${run.turretTurnLevel}`;
  ui.weaponMissile.textContent = run.weapons.missile ? `Mk.${run.weapons.missile}` : 'LOCKED';
  ui.weaponNova.textContent = run.weapons.nova ? `Mk.${run.weapons.nova}` : 'LOCKED';
  ui.weaponLaser.textContent = run.weapons.laser ? `Mk.${run.weapons.laser}` : 'LOCKED';
  ui.weaponRicochet.textContent = run.weapons.ricochet ? `Mk.${run.weapons.ricochet}` : 'LOCKED';
  ui.weaponTrail.textContent = run.weapons.trail ? `Mk.${run.weapons.trail}` : 'LOCKED';
  ui.lastUpgrade.textContent = run.lastUpgradeLabel;
  updateResearchButton(ui.damageResearch, 'DMG', meta.damageResearch);
  updateResearchButton(ui.hullResearch, 'HULL', meta.hullResearch);
  ui.damageResearchEffect.textContent = `×${(1.18 ** meta.damageResearch).toFixed(2)}`;
  ui.hullResearchEffect.textContent = String(state.ship.maxHp);
  ui.ascend.hidden = false;
  ui.ascend.disabled = !canAscend(state.wave);
  ui.ascend.textContent = canAscend(state.wave)
    ? `ASCEND +${Math.max(1, Math.floor((state.wave / 25) ** 1.65))}`
    : `ASCEND AT WAVE 25`;
}

function updateResearchButton(button: HTMLButtonElement, label: string, level: number): void {
  const cost = researchCost(level);
  button.textContent = `${label} Lv.${level} — ${formatIncremental(cost)} DATA`;
  button.disabled = meta.data < cost;
}

function updatePanelOcclusion(): void {
  const camera = getArenaCamera(state);
  const shipX = state.ship.x - camera.x;
  const shipY = state.ship.y - camera.y;
  const margin = 28;
  for (const panel of document.querySelectorAll<HTMLElement>('.panel')) {
    const rect = panel.getBoundingClientRect();
    const overlaps = shipX >= rect.left - margin
      && shipX <= rect.right + margin
      && shipY >= rect.top - margin
      && shipY <= rect.bottom + margin;
    panel.dataset.shipOverlap = String(overlaps);
  }
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function loadCraftPreference(): CraftPreference {
  const value = localStorage.getItem('rl-arena-craft-preference');
  return value === 'interceptor' || value === 'strafer' || value === 'turret' ? value : 'random';
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

ui.pause.addEventListener('click', () => {
  paused = !paused;
  ui.pause.textContent = paused ? '再開' : '一時停止';
  ui.pause.dataset.active = String(paused);
});
for (const button of document.querySelectorAll<HTMLButtonElement>('.drawer-toggle')) {
  button.addEventListener('click', () => {
    const panel = button.closest<HTMLElement>('.panel');
    if (!panel) return;
    const willOpen = panel.dataset.drawerOpen !== 'true';
    for (const other of document.querySelectorAll<HTMLElement>('[data-drawer-open]')) {
      other.dataset.drawerOpen = 'false';
    }
    panel.dataset.drawerOpen = String(willOpen);
  });
}
ui.craftSelect.addEventListener('change', () => {
  const preference = ui.craftSelect.value as CraftPreference;
  localStorage.setItem('rl-arena-craft-preference', preference);
  agent.finishEpisode(0);
  accumulatedReward = 0;
  run = createRunProgress();
  setCraftPreference(state, preference, false);
  resetEpisode(state);
  configureShipFromProgress();
  state.ship.hp = state.ship.maxHp;
  persist();
  showBanner(
    preference === 'random'
      ? `NEW RUN — AUTO ${craftLabel(state.ship.craftType)}`
      : `NEW RUN — ${craftLabel(state.ship.craftType)}`,
  );
});
ui.damageResearch.addEventListener('click', () => {
  if (buyResearch(meta, 'damage')) {
    showBanner('DAMAGE RESEARCH +18%');
    persist();
  }
});
ui.hullResearch.addEventListener('click', () => {
  if (buyResearch(meta, 'hull')) {
    showBanner('HULL RESEARCH +20%');
    persist();
  }
});
ui.ascend.addEventListener('click', () => {
  const earned = ascend(meta, state.wave);
  if (!earned) return;
  agent.finishEpisode(0);
  run = createRunProgress();
  resetEpisode(state);
  configureShipFromProgress();
  state.ship.hp = state.ship.maxHp;
  showBanner(`ASCENSION ${meta.ascensions}  +${earned} ASCENDIUM`, 5);
  persist();
});
window.addEventListener('resize', resize);
window.addEventListener('beforeunload', persist);
window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space') return;
  event.preventDefault();
  ui.pause.click();
});

resize();
configureShipFromProgress();
showBanner(
  loaded
    ? 'PERMANENT RESEARCH RESTORED'
    : 'LIVE RUN START',
);
requestAnimationFrame(frame);
