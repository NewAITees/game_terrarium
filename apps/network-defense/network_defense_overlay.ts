import { appendLogPanelEntry, formatPaddedSecondPrefix } from '../../shared/log-panel.js';
import { AGENT_COSTS } from './network_defense_config.js';

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
  document.getElementById('time')!.textContent = String(Math.floor(game.elapsed));
  document.getElementById('score')!.textContent = String(game.score);
  document.getElementById('credits')!.textContent = String(Math.floor(game.credits));
  document.getElementById('wave')!.textContent = String(game.wave);
  document.getElementById('kills')!.textContent = String(game.kills);
  document.getElementById('health')!.textContent = String(Math.max(0, Math.round(topo.server.hp)));
  (document.getElementById('buy-junior') as HTMLButtonElement).disabled = game.credits < AGENT_COSTS.junior;
  (document.getElementById('buy-mid') as HTMLButtonElement).disabled = game.credits < AGENT_COSTS.mid;
  (document.getElementById('buy-senior') as HTMLButtonElement).disabled = game.credits < AGENT_COSTS.senior;
  (document.getElementById('harden') as HTMLElement).style.opacity = game.credits < 20 ? '0.4' : '1';
  (document.getElementById('reboot') as HTMLElement).style.opacity = game.credits < 40 ? '0.4' : '1';
}
