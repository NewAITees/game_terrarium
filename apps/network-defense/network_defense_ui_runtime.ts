import {
  interactNetworkDefenseNode,
  setNetworkDefenseMessage,
  setNetworkDefenseMode,
} from './network_defense_controls.js';
import { logNetworkDefenseEvent } from './network_defense_overlay.js';

export function createNetworkDefenseUiRuntime(context: any) {
  function setMessage(text: string, alert = false): void {
    setNetworkDefenseMessage(text, alert);
  }

  function logEvent(text: string, type = 'info'): void {
    logNetworkDefenseEvent(context.game, text, type);
  }

  function setMode(mode: string): void {
    setNetworkDefenseMode(context.game, mode);
  }

  function interactNode(node: any): void {
    interactNetworkDefenseNode(node, context.game, setMessage, logEvent);
  }

  function toggleLowLoadMode(force?: boolean): void {
    const next = typeof force === 'boolean' ? force : !context.game.lowLoadMode;
    if (next === context.game.lowLoadMode) return;
    context.game.lowLoadMode = next;
    context.game.telemetryCooldown = 0;
    context.applyRenderProfile(context.game.lowLoadMode);
    setMessage(next ? 'Low-load observation enabled.' : 'Full observation restored.');
    logEvent(
      next ? 'Observer mode switched to low-load rendering.' : 'Observer mode returned to full rendering.',
      'summary'
    );
  }

  function bindInputs(): void {
    document.getElementById('harden')?.addEventListener('click', () => setMode('harden'));
    document.getElementById('reboot')?.addEventListener('click', () => setMode('reboot'));
    document.getElementById('buy-junior')?.addEventListener('click', () => context.buyAgent('junior'));
    document.getElementById('buy-mid')?.addEventListener('click', () => context.buyAgent('mid'));
    document.getElementById('buy-senior')?.addEventListener('click', () => context.buyAgent('senior'));
    document.getElementById('end-restart')?.addEventListener('click', () => location.reload());

    window.addEventListener('pointerdown', (event) => {
      context.pointer.x = (event.clientX / innerWidth) * 2 - 1;
      context.pointer.y = -(event.clientY / innerHeight) * 2 + 1;
      context.raycaster.setFromCamera(context.pointer, context.camera);
      const hits = context.raycaster.intersectObjects(context.clickable, false);
      if (hits.length) interactNode(hits[0].object.userData.node);
    });

    window.addEventListener('resize', () => {
      context.camera.aspect = innerWidth / innerHeight;
      context.camera.updateProjectionMatrix();
      context.applyRenderProfile(context.game.lowLoadMode);
    });
  }

  return {
    bindInputs,
    interactNode,
    logEvent,
    setMessage,
    setMode,
    toggleLowLoadMode,
  };
}
