import { BoxGeometry, Mesh, MeshLambertMaterial, type Clock } from 'three';
import { startAnimationFrameLoop } from '../../shared/browser-runtime.js';
import { updateEscortTdHud, updateEscortTdVisibility } from './escort_td_scene.js';
import { createEscortEnemyVisual, createEscortUnitVisual, setEscortUnitAim } from './escort_td_visuals.js';
import { CS, VIP_HP_MAX, g2w, type CommandMode, type PieceType } from './escort_td_core.js';
import type { EscortTdAction, EscortTdBarricadeSnapshot, EscortTdEnemySnapshot, EscortTdMetaProgress, EscortTdStateSnapshot, EscortTdUnitSnapshot } from '../../shared/types/escort_td.js';
import { getEscortMetaUpgradeCost } from '../../game/escort_td_rules.js';

const CHIP_TOTAL_STORAGE_KEY = 'escort-td:v2:chip-total';
const CHIP_RESULT_STORAGE_PREFIX = 'escort-td:v2:result:';
const META_STORAGE_KEY = 'escort-td:v2:meta';
const META_LABEL: Record<keyof EscortTdMetaProgress, string> = {
  startGoldLevel: 'START GOLD +30',
  kingHpLevel: 'KING HP +100',
  unitLimitLevel: 'UNIT LIMIT +1',
};

export function createEscortTdRuntime(context: any) {
  const vipMesh = createVipMesh(context.scene);
  const coverageGuide = createCoverageGuide(context.scene);
  const unitMeshes = new Map<number, any>();
  const enemyMeshes = new Map<number, any>();
  const barricadeMeshes = new Map<number, any>();
  let latest: EscortTdStateSnapshot = context.initialState;
  let pollingTimer: number | null = null;
  let meta = readMetaProgress();

  function getCommandMode(): CommandMode {
    return latest.commandMode as CommandMode;
  }

  function isKingPaused(): boolean {
    return latest.king.paused;
  }

  function isForceAdvance(): boolean {
    return latest.king.forcedAdvance;
  }

  function getTimeScale(): 0 | 1 | 2 | 4 {
    return latest.timeScale;
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
    const progressFill = document.getElementById('progress-fill');
    if (progressFill) progressFill.style.width = `${latest.progressPercent}%`;
    setText('progress-val', `${latest.progressPercent}%`);
    const coverageFill = document.getElementById('coverage-fill');
    if (coverageFill) {
      coverageFill.style.width = `${latest.king.coveragePercent}%`;
      coverageFill.style.background = latest.king.advanceBlocked ? '#f84' : '#7cf7ff';
    }
    setText('coverage-val', `${latest.king.coveragePercent}%`);
    setText('chip-total', readChipTotal());
    syncMetaPanel(Boolean(latest.result));
  }

  function applyState(state: EscortTdStateSnapshot): void {
    latest = state;
    if (state.result) recordResultChips(state);
    vipMesh.position.set(state.king.x, CS * 0.36, state.king.z);
    syncCoverageGuide(coverageGuide, state);
    syncUnits(state.units);
    syncEnemies(state.enemies);
    syncBarricades(state.barricades);
    updateHud();
    syncVisibility();
    if (state.result) {
      const label = state.result.outcome === 'cleared' ? 'ESCORT COMPLETE' : 'ESCORT HARVESTED';
      const color = state.result.outcome === 'cleared' ? '#4f4' : '#f84';
      showMessage(`${label}\nDISTANCE ${state.result.progressPercent}%  SCORE ${state.result.score}\nCHIP +${state.result.chips}\n[R] RESTART`, color);
    } else hideMessage();
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

  function syncBarricades(barricades: EscortTdBarricadeSnapshot[]): void {
    const active = new Set<number>();
    for (const barricade of barricades) {
      active.add(barricade.id);
      let mesh = barricadeMeshes.get(barricade.id);
      if (!mesh) {
        mesh = new Mesh(
          new BoxGeometry(CS * 0.8, CS * 0.55, CS * 0.8),
          new MeshLambertMaterial({ color: 0xc66b3d, emissive: 0x3a1208, emissiveIntensity: 0.3 }),
        );
        context.scene.add(mesh);
        barricadeMeshes.set(barricade.id, mesh);
      }
      const point = g2w(barricade.gx, barricade.gy);
      mesh.position.set(point.x, CS * 0.275, point.z);
      mesh.material.color.set(barricade.hp / barricade.hpMax > 0.5 ? 0xc66b3d : 0xff5d43);
    }
    for (const [id, mesh] of barricadeMeshes) {
      if (active.has(id)) continue;
      context.scene.remove(mesh);
      barricadeMeshes.delete(id);
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

  function purchaseMetaUpgrade(key: keyof EscortTdMetaProgress): void {
    const cost = getEscortMetaUpgradeCost(meta[key]);
    const chips = readChipTotal();
    if (!latest.result || chips < cost) return;
    meta = { ...meta, [key]: meta[key] + 1 };
    localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta));
    localStorage.setItem(CHIP_TOTAL_STORAGE_KEY, String(chips - cost));
    updateHud();
  }

  function syncMetaPanel(open: boolean): void {
    const panel = document.getElementById('meta-panel');
    if (!panel) return;
    panel.dataset.open = String(open);
    for (const key of Object.keys(META_LABEL) as Array<keyof EscortTdMetaProgress>) {
      const button = panel.querySelector(`[data-meta="${key}"]`) as HTMLButtonElement | null;
      if (!button) continue;
      const cost = getEscortMetaUpgradeCost(meta[key]);
      button.textContent = `${META_LABEL[key]}  Lv.${meta[key]}  [${cost} CHIP]`;
      button.disabled = !open || readChipTotal() < cost;
    }
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
    for (const key of Object.keys(META_LABEL) as Array<keyof EscortTdMetaProgress>) {
      document.querySelector(`[data-meta="${key}"]`)?.addEventListener('click', () => purchaseMetaUpgrade(key));
    }
  }

  return {
    placeUnit: (gx: number, gy: number, type: PieceType) => void postAction({ action: 'place_unit', gx, gy, type }),
    placeBarricade: (gx: number, gy: number) => void postAction({ action: 'place_barricade', gx, gy }),
    reclaimAt: (gx: number, gy: number) => void postAction({ action: 'reclaim_at', gx, gy }),
    deployFromKing: () => void postAction({ action: 'deploy' }),
    toggleKingPause: () => void postAction({ action: 'toggle_pause' }),
    toggleForceAdvance: () => void postAction({ action: 'toggle_force_advance' }),
    setCommandMode: (mode: CommandMode) => void postAction({ action: 'set_command_mode', mode }),
    setTimeScale: (speed: 0 | 1 | 2 | 4) => void postAction({ action: 'set_speed', speed }),
    getCommandMode,
    isKingPaused,
    isForceAdvance,
    getTimeScale,
    restartIfFinished: () => {
      if (latest.over || latest.won) void postAction({ action: 'restart', meta });
    },
    start,
  };
}

function createCoverageGuide(scene: any): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(1, 0.05, CS * 0.18),
    new MeshLambertMaterial({ color: 0x5dffcc, emissive: 0x1b6b62, emissiveIntensity: 0.6, transparent: true, opacity: 0.65 }),
  );
  mesh.position.y = 0.28;
  scene.add(mesh);
  return mesh;
}

function syncCoverageGuide(guide: Mesh, state: EscortTdStateSnapshot): void {
  const dx = state.king.nextX - state.king.x;
  const dz = state.king.nextZ - state.king.z;
  const length = Math.max(0.1, Math.hypot(dx, dz));
  guide.position.set((state.king.x + state.king.nextX) * 0.5, 0.28, (state.king.z + state.king.nextZ) * 0.5);
  guide.rotation.y = Math.atan2(dx, dz);
  guide.scale.x = length;
  const material = guide.material as MeshLambertMaterial;
  const danger = state.king.advanceBlocked && !state.king.forcedAdvance;
  material.color.set(danger ? 0xff5d43 : 0x5dffcc);
  material.emissive.set(danger ? 0x701a12 : 0x1b6b62);
  material.opacity = danger ? 0.9 : 0.45;
}

function readChipTotal(): number {
  const value = Number.parseInt(localStorage.getItem(CHIP_TOTAL_STORAGE_KEY) ?? '0', 10);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function recordResultChips(state: EscortTdStateSnapshot): void {
  const result = state.result;
  if (!result) return;
  const key = `${CHIP_RESULT_STORAGE_PREFIX}${state.citySeed}:${result.outcome}:${result.progressPercent}:${result.score}:${result.kills.ground}:${result.kills.air}:${result.kills.siege}`;
  if (localStorage.getItem(key) === 'recorded') return;
  localStorage.setItem(CHIP_TOTAL_STORAGE_KEY, String(readChipTotal() + result.chips));
  localStorage.setItem(key, 'recorded');
}

function readMetaProgress(): EscortTdMetaProgress {
  try {
    const stored = JSON.parse(localStorage.getItem(META_STORAGE_KEY) ?? '{}') as Partial<EscortTdMetaProgress>;
    return {
      startGoldLevel: validMetaLevel(stored.startGoldLevel),
      kingHpLevel: validMetaLevel(stored.kingHpLevel),
      unitLimitLevel: validMetaLevel(stored.unitLimitLevel),
    };
  } catch {
    return { startGoldLevel: 0, kingHpLevel: 0, unitLimitLevel: 0 };
  }
}

function validMetaLevel(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(20, Math.floor(value))) : 0;
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

function setText(id: string, value: string | number): void {
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
