import { Clock, } from 'three';
import {
  edgeKey,
  tickEdges,
} from '../../shared/network-core.js';
import {
  applyPersonalitiesToRules,
  applyPersonalityToAgent,
  buildObserverSnapshot,
} from './network_defense_personality.js';
import {
  WIN_WAVE,
} from './network_defense_config.js';
import { createObservationEvents } from './network_defense_events.js';
import {
  observerBreachSpike,
  observerPulseCalm,
} from './network_defense_observer_mode.js';
import { createNetworkDefenseRuleRuntime } from './network_defense_rule_runtime.js';
import { startNetworkDefenseLoop } from './network_defense_loop.js';
import { scanNetworkForWave } from './network_defense_wave.js';
import { createObservationUi } from './network_defense_ui.js';
import { createNetworkDefenseRuntime } from './network_defense_runtime.js';
import { createNetworkDefenseUiRuntime } from './network_defense_ui_runtime.js';
import { initializeNetworkDefenseSetup } from './network_defense_setup.js';
import { createNetworkDefenseAppHelpers } from './network_defense_app_helpers.js';
import { NetworkDefenseRlController } from './network_defense_rl.js';

const NETWORK_DEFENSE_RL_STORAGE_KEY = 'network-defense-rl-v1';

export function startNetworkDefenseApp({ observerMode = false }: { observerMode?: boolean } = {}): void {
const rlMode = !observerMode && new URLSearchParams(location.search).get('ai') !== 'rules';
const {
  adj,
  agents,
  attackPool,
  defensePackets,
  enemyPackets,
  firewalls,
  game,
  normalPackets,
  normalPool,
  rankPersonalities,
  render,
  rng,
  scanPackets,
  terms,
  triggerFlash,
} = initializeNetworkDefenseSetup(observerMode);
const {
  scene,
  camera,
  controls,
  composer,
  raycaster,
  pointer,
  clickable,
  topo,
  spinData,
  edgeMap,
  allEdges,
  mats,
  serverGlow,
  applyRenderProfile,
} = render;
let setMessage = (_text: string, _alert = false): void => {};
let logEvent = (_text: string, _type = 'info'): void => {};
let requestBuyAgent = (_rank: string): void => {};
let toggleLowLoadMode = (_force?: boolean): void => {};
const observationUi = observerMode
  ? createObservationUi({
      onToggleLowLoadMode: () => toggleLowLoadMode(undefined),
      onIntervenePulse: () => observerPulseCalm(topo, setMessage, logEvent),
      onInterveneBreach: () => observerBreachSpike(topo, setMessage, logEvent),
    })
  : { update: (_state: any) => {} };
const observationEvents = observerMode
  ? createObservationEvents({
      game,
      topo,
      rng,
      logEvent: (text: string, type?: string) => logEvent(text, type),
      setMessage: (text: string, alert = false) => setMessage(text, alert),
    })
  : {
      update: (_dt: number, _now: number) => {},
      getHudState: () => ({ label: 'Idle Grid', detail: 'observer mode inactive' }),
    };

const {
  createPacket,
  deployFirewall,
  edgeTravelFactor,
  enemyFrontierTarget,
  firewallKey,
  hottestNode,
  patrolTarget,
  perimeterNode,
  route,
  safeRoute,
  seedAgents,
  sendAgent,
  updateFirewalls,
  weakestDamagedNode,
} = createNetworkDefenseAppHelpers({
  adj,
  agents,
  applyPersonalityToAgent,
  edgeKey,
  firewalls,
  game,
  observerMode,
  rankPersonalities,
  rng,
  scene,
  terms,
  topo,
});

seedAgents();

const ruleRuntime = createNetworkDefenseRuleRuntime({
  observerMode,
  rankPersonalities,
  applyPersonalitiesToRules,
  scanNetwork,
  setRuleStatus: (text) => {
    const el = document.getElementById('rules-status');
    if (el) el.textContent = text;
  },
  setMessage: (text: string, alert = false) => setMessage(text, alert),
  logEvent: (text: string, type?: string) => logEvent(text, type),
  sendAgent,
  hottestNode,
  weakestDamagedNode,
  patrolTarget,
  buyAgent: (rank: string) => requestBuyAgent(rank),
  game,
  topo,
  adj,
  agents,
  enemyPackets,
  firewalls,
  rng,
});

const {
  assignAgent: assignRuleAgent,
  buildSnapshot,
  execAction,
  loadAgentRules,
  triggerRuleUpdate,
} = ruleRuntime;

const rlController = rlMode
  ? new NetworkDefenseRlController({
      game,
      topo,
      agents,
      enemyPackets,
      firewalls,
      buildSnapshot,
      executeAction: (agent, action, snapshot) => execAction(agent, action, snapshot),
    })
  : null;
if (rlController) {
  try {
    const raw = localStorage.getItem(NETWORK_DEFENSE_RL_STORAGE_KEY);
    if (raw) rlController.restore(JSON.parse(raw));
  } catch {
    // A corrupt learning checkpoint starts a fresh model.
  }
}
const assignAgent = rlController
  ? (agent: any) => rlController.assignAgent(agent)
  : assignRuleAgent;

function scanNetwork() {
  return scanNetworkForWave(topo, firewalls, enemyPackets);
}

const runtime = createNetworkDefenseRuntime({
  adj,
  agents,
  applyPersonalityToAgent,
  attackPool,
  buildObserverSnapshot,
  createPacket,
  defensePackets,
  deployFirewall,
  edgeKey,
  edgeMap,
  edgeTravelFactor,
  enemyFrontierTarget,
  enemyPackets,
  firewalls,
  firewallKey,
  game,
  logEvent: (text: string, type?: string) => logEvent(text, type),
  normalPackets,
  normalPool,
  observationEvents,
  observationUi,
  observerMode,
  perimeterNode,
  rankPersonalities,
  rng,
  route,
  safeRoute,
  scanPackets,
  scene,
  setMessage: (text: string, alert = false) => setMessage(text, alert),
  topo,
  triggerFlash,
  winWave: WIN_WAVE,
  assignAgent,
  triggerRuleUpdate: rlMode ? async () => {} : triggerRuleUpdate,
});

const {
  applyAttack,
  applyDefense,
  buyAgent: runtimeBuyAgent,
  reportTelemetry,
  spawnEnemy,
  spawnNormalTraffic,
  spawnScanner,
  updateAgents,
  updateHud,
  updateNodes,
  updatePackets,
  updateScanPackets,
  updateSeniorStrategy,
  updateWave,
} = runtime;

const uiRuntime = createNetworkDefenseUiRuntime({
  game,
  camera,
  clickable,
  pointer,
  raycaster,
  applyRenderProfile,
  buyAgent: (rank: string) => requestBuyAgent(rank),
});

setMessage = uiRuntime.setMessage;
logEvent = uiRuntime.logEvent;
toggleLowLoadMode = uiRuntime.toggleLowLoadMode;
requestBuyAgent = runtimeBuyAgent;
uiRuntime.bindInputs();

if (!rlMode) loadAgentRules();
else {
  const status = document.getElementById('rules-status');
  if (status) status.textContent = 'RL ACTIVE';
}
if (observerMode && rankPersonalities) {
  for (const [rank, personality] of Object.entries(rankPersonalities)) {
    logEvent(`${rank} personality: ${personality.label} — ${personality.summary}`, 'summary');
  }
}
startNetworkDefenseLoop({
  clock: new Clock(),
  game,
  observerMode,
  rng,
  spinData,
  serverGlow,
  attackPool,
  normalPool,
  allEdges,
  mats,
  controls,
  composer,
  edgeTick: tickEdges,
  onReloadRules: rlMode ? () => {} : loadAgentRules,
  onUpdateWave: updateWave,
  onUpdateSeniorStrategy: rlMode ? () => {} : updateSeniorStrategy,
  onObservationUpdate: (dt, now) => observationEvents.update(dt, now),
  onSpawnEnemy: spawnEnemy,
  onSpawnNormalTraffic: spawnNormalTraffic,
  onSpawnScanner: spawnScanner,
  onUpdateEnemyPackets: (dt, now) => updatePackets(enemyPackets, dt, (node, packet) => applyAttack(node, packet.damage, now)),
  onUpdateDefensePackets: (dt) => updatePackets(defensePackets, dt, (node, packet) => applyDefense(node, packet.repair)),
  onUpdateNormalPackets: (dt) => updatePackets(normalPackets, dt, node => { if (node) triggerFlash(normalPool, node); }),
  onUpdateScanPackets: updateScanPackets,
  onUpdateAgents: updateAgents,
  onUpdateFirewalls: updateFirewalls,
  onUpdateNodes: updateNodes,
  onUpdateLearning: (() => {
    let saveCooldown = 5;
    let hudCooldown = 0;
    let restartScheduled = false;
    return (dt: number) => {
      if (!rlController) return;
      saveCooldown -= dt;
      hudCooldown -= dt;
      if (hudCooldown <= 0) {
        const status = document.getElementById('rules-status');
        const decision = rlController.decision;
        if (status) {
          status.textContent = [
            'RL',
            decision?.action ?? 'WAIT',
            decision?.exploratory ? 'EXPLORE' : 'POLICY',
            `ε ${(rlController.epsilon * 100).toFixed(1)}%`,
            `${rlController.knownStates} states`,
          ].join(' · ');
        }
        hudCooldown = 0.25;
      }
      if (saveCooldown <= 0 || game.gameOver) {
        if (game.gameOver) rlController.finishEpisode(Boolean(game.victory));
        localStorage.setItem(NETWORK_DEFENSE_RL_STORAGE_KEY, JSON.stringify(rlController.serialize()));
        saveCooldown = 5;
      }
      if (game.gameOver && !restartScheduled) {
        restartScheduled = true;
        window.setTimeout(() => location.reload(), 1800);
      }
    };
  })(),
  onUpdateHud: updateHud,
  onReportTelemetry: reportTelemetry,
});
}
