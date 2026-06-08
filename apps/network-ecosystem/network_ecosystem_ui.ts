import * as THREE from 'three';
import { balanceScore } from './network_ecosystem_metrics.js';
import type { EcosystemGameState, EcosystemTotals } from '../../shared/types/network_ecosystem.js';

export function setEcosystemMessage(text: string, alert = false): void {
  const message = document.getElementById('message');
  if (!message) return;
  message.textContent = text;
  message.className = alert ? 'alert' : '';
}

export function setEcosystemMode(game: EcosystemGameState, mode: EcosystemGameState['mode']): void {
  game.mode = mode;
  document.getElementById('seed-immune')?.classList.toggle('active', mode === 'immune');
  document.getElementById('seed-threat')?.classList.toggle('active', mode === 'threat');
}

export function interactEcosystemNode(node: any, game: EcosystemGameState): void {
  if (!node) return;
  if (game.mode === 'immune') {
    node.immune = Math.max(0, Math.min(1, node.immune + 0.5));
    node.resource = Math.max(0, Math.min(1, node.resource + 0.12));
    setEcosystemMessage(`Immune culture seeded at node ${node.id}.`);
    return;
  }

  node.threat = Math.max(0, Math.min(1, node.threat + 0.45));
  node.resource = Math.max(0, Math.min(1, node.resource - 0.15));
  setEcosystemMessage(`Threat bloom introduced at node ${node.id}.`, true);
}

export function updateEcosystemNodeVisuals(topo: any): void {
  const healthy = new THREE.Color(0x79d984);
  const immune = new THREE.Color(0x57d7ff);
  const threat = new THREE.Color(0xff5b3d);
  const carnivore = new THREE.Color(0xffd35a);
  const depleted = new THREE.Color(0x4a514b);

  for (const node of topo.nodes) {
    const color = depleted.clone().lerp(healthy, node.resource);
    color.lerp(immune, node.immune * 0.72);
    color.lerp(threat, node.threat * 0.82);
    color.lerp(carnivore, node.carnivore * 0.9);

    node.material.color.copy(color);
    node.material.emissive.copy(color).multiplyScalar(0.34 + node.immune * 0.42 + node.threat * 0.35 + node.carnivore * 0.48);
    node.material.emissiveIntensity = node.baseStyle.emI + node.immune * 1.5 + node.threat * 1.2 + node.carnivore * 1.7;
    if (node.halo?.material) {
      node.halo.material.color.copy(color);
      node.halo.material.opacity = node.baseStyle.hOp + node.immune * 0.08 + node.threat * 0.12 + node.carnivore * 0.13;
    }
  }
}

export function updateEcosystemHud(topo: any): void {
  const totals = topo.nodes.reduce((acc: EcosystemTotals, node: any) => {
    acc.resource += node.resource;
    acc.threat += node.threat;
    acc.immune += node.immune;
    acc.carnivore += node.carnivore;
    return acc;
  }, { resource: 0, threat: 0, immune: 0, carnivore: 0 });
  const count = topo.nodes.length;
  const balance = Math.round(balanceScore(totals, count) * 100);
  const balanceEl = document.getElementById('balance');
  const immuneEl = document.getElementById('immune');
  const stressEl = document.getElementById('stress');
  const carnivoreEl = document.getElementById('carnivore');

  if (balanceEl) balanceEl.textContent = String(balance);
  if (immuneEl) immuneEl.textContent = String(Math.round((totals.immune / count) * 100));
  if (stressEl) stressEl.textContent = String(Math.round((totals.threat / count) * 100));
  if (carnivoreEl) carnivoreEl.textContent = ((totals.carnivore / count) * 100).toFixed(1);
}
