import { appendLogPanelEntry, formatPaddedSecondPrefix } from '../../shared/log-panel.js';
import { AGENT_COSTS } from './network_defense_config.js';

let missingHudIdsReported = false;

export function logNetworkDefenseEvent(game: any, text: string, type = 'info') {
  appendLogPanelEntry({
    elapsedSeconds: game.elapsed,
    formatPrefix: formatPaddedSecondPrefix,
    text,
    type,
  });
}

export function showNetworkDefenseEndOverlay(game: any, topo: any, agents: any[], firewalls: Map<any, any>, isVictory: boolean) {
  game.gameOver = true;
  game.victory = isVictory;
  const overlay = document.getElementById('end-overlay');
  const title = document.getElementById('end-title');
  const stats = document.getElementById('end-stats');
  if (!overlay || !title || !stats) return;
  title.textContent = isVictory ? 'MISSION COMPLETE' : 'SERVER DOWN';
  title.className = isVictory ? 'victory' : 'defeat';
  const elapsed = Math.floor(game.elapsed);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  stats.innerHTML = [
    ['Wave', game.wave],
    ['Score', game.score],
    ['Time', `${mm}:${ss}`],
    ['Kills', game.kills],
    ['Server HP', Math.max(0, Math.round(topo.server.hp))],
    ['Agents', agents.length],
    ['Firewalls', firewalls.size],
  ].map(([lbl, val]) =>
    `<div class="end-row"><span class="lbl">${lbl}</span><span class="val">${val}</span></div>`
  ).join('');
  overlay.classList.add('show');
}

export function updateNetworkDefenseHud(game: any, topo: any) {
  const requiredIds = ['time', 'score', 'credits', 'wave', 'kills', 'health', 'buy-junior', 'buy-mid', 'buy-senior', 'harden', 'reboot'] as const;
  const elements = Object.fromEntries(
    requiredIds.map((id) => [id, document.getElementById(id)])
  ) as Record<(typeof requiredIds)[number], HTMLElement | null>;
  const missingIds = requiredIds.filter((id) => !elements[id]);
  if (missingIds.length) {
    if (!missingHudIdsReported) {
      console.error(`network_defense HUD missing elements: ${missingIds.join(', ')}`);
      missingHudIdsReported = true;
    }
    return;
  }
  elements.time.textContent = String(Math.floor(game.elapsed));
  elements.score.textContent = String(game.score);
  elements.credits.textContent = String(Math.floor(game.credits));
  elements.wave.textContent = String(game.wave);
  elements.kills.textContent = String(game.kills);
  elements.health.textContent = String(Math.max(0, Math.round(topo.server.hp)));
  (elements['buy-junior'] as HTMLButtonElement).disabled = game.credits < AGENT_COSTS.junior;
  (elements['buy-mid'] as HTMLButtonElement).disabled = game.credits < AGENT_COSTS.mid;
  (elements['buy-senior'] as HTMLButtonElement).disabled = game.credits < AGENT_COSTS.senior;
  elements.harden.style.opacity = game.credits < 20 ? '0.4' : '1';
  elements.reboot.style.opacity = game.credits < 40 ? '0.4' : '1';
}
