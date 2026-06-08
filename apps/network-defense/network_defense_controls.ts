export function setNetworkDefenseMessage(text: string, alert = false): void {
  const message = document.getElementById('message');
  if (!message) return;
  message.textContent = text;
  message.className = alert ? 'alert' : '';
}

export function setNetworkDefenseMode(game: any, mode: string): void {
  game.mode = mode;
  document.getElementById('harden')?.classList.toggle('active', mode === 'harden');
  document.getElementById('reboot')?.classList.toggle('active', mode === 'reboot');
}

export function interactNetworkDefenseNode(node: any, game: any, setMessage: (text: string, alert?: boolean) => void, logEvent: (text: string, type?: string) => void): void {
  if (!node || game.gameOver) return;
  const now = performance.now() / 1000;
  if (game.mode === 'harden') {
    if (game.credits < 20) { setMessage('Need 20cr to harden a node.', true); return; }
    game.credits -= 20;
    node.hardenUntil = now + 8;
    node.hp = Math.min(node.maxHp, node.hp + 18);
    setMessage(`Hardened ${node.isServer ? 'SERVER' : node.layer.toUpperCase()} node ${node.id}. (-20cr)`);
    logEvent(`Player: harden node ${node.id} [${node.isServer ? 'server' : node.layer}] (−20cr)`, 'player');
    return;
  }

  if (game.credits < 40) { setMessage('Need 40cr to reboot a node.', true); return; }
  game.credits -= 40;
  node.rebootUntil = now + 4.5;
  node.infection = Math.max(0, node.infection - 0.55);
  setMessage(`Forced reboot on node ${node.id}. (-40cr)`);
  logEvent(`Player: reboot node ${node.id} [${node.isServer ? 'server' : node.layer}] (−40cr)`, 'player');
}
