import { callStrategyLlm, scanStrategyNetwork } from './network_defense_strategy.js';

export function scanNetworkForWave(topo: any, firewalls: Map<any, any>, enemyPackets: any[]) {
  return scanStrategyNetwork(topo, firewalls, enemyPackets);
}

export function updateSeniorStrategy(context: {
  agents: any[];
  game: any;
  topo: any;
  firewalls: Map<any, any>;
  enemyPackets: any[];
  observerMode: boolean;
  setMessage: (text: string) => void;
}): void {
  const { agents, game, topo, firewalls, enemyPackets, observerMode, setMessage } = context;
  const senior = agents.find((agent) => agent.rank === 'senior');
  game.seniorAlive = Boolean(senior);
  if (!game.seniorAlive) return;

  const snapshot = scanNetworkForWave(topo, firewalls, enemyPackets);
  callStrategyLlm(snapshot, game, topo).then((nextRule) => {
    if (nextRule !== game.rule) {
      game.rule = nextRule;
      const rulesEl = document.getElementById('rules');
      if (rulesEl) rulesEl.textContent = `rules: ${nextRule}`;
      setMessage(`Senior alert: rules.txt -> ${nextRule}`);
      if (observerMode) game.rankIntents.senior = `adapt network posture to ${nextRule}`;
    }
  });
}

export function updateWave(context: {
  dt: number;
  game: any;
  topo: any;
  enemyPackets: any[];
  winWave: number;
  showEndOverlay: (isVictory: boolean) => void;
  logEvent: (text: string, type?: string) => void;
  setMessage: (text: string) => void;
  triggerRuleUpdate: () => void;
}): void {
  const { dt, game, topo, enemyPackets, winWave, showEndOverlay, logEvent, setMessage, triggerRuleUpdate } = context;
  if (game.gameOver) return;
  if (game.waveRemaining > 0) return;
  if (enemyPackets.length > 0) return;

  game.waveCooldown -= dt;
  if (game.waveCooldown > 0) return;

  const waveKills = game.kills - game.waveStartKills;
  const wavePct = game.waveSpawned > 0 ? Math.round((waveKills / game.waveSpawned) * 100) : 0;
  const hpDrop = Math.round(game.waveServerHpStart - topo.server.hp);
  const actStr = Object.entries(game.waveActions).map(([r, n]) => `${r}×${n}`).join('  ') || '—';
  logEvent(`── Wave ${game.wave} complete ──`, 'wave');
  logEvent(`  blocked ${waveKills}/${game.waveSpawned} (${wavePct}%)  HP −${hpDrop}`, 'summary');
  logEvent(`  actions: ${actStr}`, 'summary');

  game.wave++;
  if (game.wave > winWave && !game.victory) {
    showEndOverlay(true);
    logEvent(`🏆 VICTORY — all ${winWave} waves cleared!`, 'wave');
    return;
  }

  game.waveSpawned = 0;
  game.waveStartKills = game.kills;
  game.waveServerHpStart = Math.round(topo.server.hp);
  game.waveActions = {};
  game.waveRemaining = 5 + game.wave * 2;
  game.nextAttack = 0.45;
  game.waveCooldown = 2.5;
  game.score += 75 + game.wave * 10;
  game.credits = Math.min(999, game.credits + 25 + game.wave * 5);
  setMessage(`Wave ${game.wave} incoming. Agents are repositioning firewalls.`);
  logEvent(`Wave ${game.wave} start — ${game.waveRemaining} enemies incoming`, 'wave');
  triggerRuleUpdate();
}
