import { BoxGeometry, Mesh, MeshLambertMaterial, type Clock } from 'three';
import { startAnimationFrameLoop } from '../../shared/browser-runtime.js';
import { updateEscortTdHud, updateEscortTdVisibility } from './escort_td_scene.js';
import { createEscortEnemyVisual, createEscortUnitVisual, setEscortUnitAim } from './escort_td_visuals.js';
import { CS, VIP_HP_MAX, type CommandMode } from './escort_td_core.js';
import type { EscortTdAction, EscortTdEnemySnapshot, EscortTdStateSnapshot, EscortTdUnitSnapshot } from '../../shared/types/escort_td.js';

export function createEscortTdRuntime(context: any) {
  const vipMesh = createVipMesh(context.scene);
  const unitMeshes = new Map<number, any>();
  const enemyMeshes = new Map<number, any>();
  let latest: EscortTdStateSnapshot = context.initialState;
  let pollingTimer: number | null = null;

  function getCommandMode(): CommandMode {
    return latest.commandMode as CommandMode;
  }

  function isKingPaused(): boolean {
    return latest.king.paused;
  }

  function updateHud(): void {
    updateEscortTdHud(context.hud, latest.king.hp, latest.king.hpMax, latest.gold, latest.wave, latest.commandMode);
    setText('ally-pawn', latest.counts.pawn);
    setText('ally-rook', latest.counts.rook);
    setText('ally-bishop', latest.counts.bishop);
    setText('ally-knight', latest.counts.knight);
    setText('ally-queen', latest.counts.queen);
    setText('enemy-ground', latest.counts.ground);
    setText('enemy-siege', latest.counts.siege);
    setText('enemy-air', latest.counts.air);
  }

  function applyState(state: EscortTdStateSnapshot): void {
    latest = state;
    vipMesh.position.set(state.king.x, CS * 0.36, state.king.z);
    syncUnits(state.units);
    syncEnemies(state.enemies);
    updateHud();
    syncVisibility();
    if (state.won) showMessage('KING ESCAPED — MISSION COMPLETE\n[R] RESTART', '#4f4');
    else if (state.over) showMessage('KING CAPTURED — MISSION FAILED\n[R] RESTART', '#f44');
    else hideMessage();
  }

  function syncUnits(units: EscortTdUnitSnapshot[]): void {
    const active = new Set<number>();
    for (const unit of units) {
      active.add(unit.id);
      let mesh = unitMeshes.get(unit.id);
      if (!mesh) {
        mesh = createEscortUnitVisual(unit.type, 'ally');
        context.scene.add(mesh);
        unitMeshes.set(unit.id, mesh);
      }
      mesh.position.set(unit.wx, CS * 0.24 + Math.sin((unit.id + latest.wave) * 0.6) * 0.08, unit.wz);
      mesh.rotation.y = unit.moveFacing;
      setEscortUnitAim(mesh, unit.aimFacing);
    }
    for (const [id, mesh] of unitMeshes) {
      if (active.has(id)) continue;
      context.scene.remove(mesh);
      unitMeshes.delete(id);
    }
  }

  function syncEnemies(enemies: EscortTdEnemySnapshot[]): void {
    const active = new Set<number>();
    for (const enemy of enemies) {
      active.add(enemy.id);
      let mesh = enemyMeshes.get(enemy.id);
      if (!mesh) {
        mesh = createEscortEnemyVisual(enemy.kind);
        context.scene.add(mesh);
        enemyMeshes.set(enemy.id, mesh);
      }
      mesh.position.set(enemy.x, enemy.kind === 'air' ? CS * 1.2 + Math.sin(enemy.bobPhase * 6) * 0.4 : CS * 0.18, enemy.z);
    }
    for (const [id, mesh] of enemyMeshes) {
      if (active.has(id)) continue;
      context.scene.remove(mesh);
      enemyMeshes.delete(id);
    }
  }

  function syncVisibility(): void {
    updateEscortTdVisibility(
      vipMesh,
      latest.units.map((unit) => ({ type: unit.type, wx: unit.wx, wz: unit.wz })) as any,
      latest.enemies.map((enemy) => ({ ...enemy, dead: false, mesh: enemyMeshes.get(enemy.id) })) as any,
      context.fogCells,
    );
  }

  async function fetchState(): Promise<void> {
    const response = await fetch('/api/escort-td/state');
    if (!response.ok) throw new Error(`escort_td state ${response.status}`);
    applyState(await response.json() as EscortTdStateSnapshot);
  }

  async function postAction(action: EscortTdAction): Promise<void> {
    const response = await fetch('/api/escort-td/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
    if (!response.ok) throw new Error(`escort_td action ${response.status}`);
    const payload = await response.json() as { ok: true; state: EscortTdStateSnapshot };
    applyState(payload.state);
  }

  function start(clock: Clock): void {
    applyState(latest);
    pollingTimer = window.setInterval(() => {
      void fetchState().catch((error: unknown) => console.error('Escort TD poll failed', error));
    }, 100);
    startAnimationFrameLoop({
      clock,
      step: () => {
        context.controls.update();
      },
      render: () => context.renderer.render(context.scene, context.camera),
    });
    window.addEventListener('beforeunload', () => {
      if (pollingTimer !== null) window.clearInterval(pollingTimer);
    }, { once: true });
  }

  return {
    placeUnit: () => {},
    deployFromKing: () => void postAction({ action: 'deploy' }),
    toggleKingPause: () => void postAction({ action: 'toggle_pause' }),
    setCommandMode: (mode: CommandMode) => void postAction({ action: 'set_command_mode', mode }),
    getCommandMode,
    isKingPaused,
    restartIfFinished: () => {
      if (latest.over || latest.won) location.reload();
    },
    start,
  };
}

function createVipMesh(scene: any) {
  const mesh = new Mesh(
    new BoxGeometry(CS * 0.54, CS * 0.72, CS * 0.54),
    new MeshLambertMaterial({ color: 0xffd700, emissive: 0xffaa00, emissiveIntensity: 0.35 })
  );
  mesh.castShadow = true;
  mesh.position.set(0, CS * 0.36, 0);
  scene.add(mesh);
  return mesh;
}

function setText(id: string, value: number): void {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value);
}

function showMessage(text: string, color: string): void {
  const msg = document.getElementById('msg');
  if (!msg) return;
  msg.textContent = text;
  msg.style.color = color;
  msg.style.whiteSpace = 'pre';
  msg.style.display = 'block';
}

function hideMessage(): void {
  const msg = document.getElementById('msg');
  if (!msg) return;
  msg.style.display = 'none';
}


