import { BoxGeometry, BufferGeometry, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, MeshLambertMaterial, TorusGeometry, Vector3, type Clock } from 'three';
import { createProjectileSystem } from './escort_td_projectiles.js';
import { startAnimationFrameLoop } from '../../shared/browser-runtime.js';
import { updateEscortTdHud, updateEscortTdVisibility } from './escort_td_scene.js';
import { createEscortEnemyVisual, createEscortUnitVisual, setEscortUnitAim } from './escort_td_visuals.js';
import { CS, VIP_HP_MAX, g2w, type CommandMode, type PieceType } from './escort_td_core.js';
import type { EscortTdAction, EscortTdApproachPathSnapshot, EscortTdBarricadeSnapshot, EscortTdEnemySnapshot, EscortTdMetaProgress, EscortTdRallyRole, EscortTdStateSnapshot, EscortTdUnitSnapshot } from '../../shared/types/escort_td.js';
import { getEscortMetaMaxLevel, getEscortMetaUpgradeCost, getEscortUpgradeCostByKey } from '../../game/escort_td_rules.js';

const CHIP_TOTAL_STORAGE_KEY = 'escort-td:v2:chip-total';
const CHIP_RESULT_STORAGE_PREFIX = 'escort-td:v2:result:';
const LIFETIME_KILLS_STORAGE_KEY = 'escort-td:v2:lifetime-kills';
const LIFETIME_SCORE_STORAGE_KEY = 'escort-td:v2:lifetime-score';
const META_STORAGE_KEY = 'escort-td:v2:meta';
const META_LABEL: Record<keyof EscortTdMetaProgress, string> = {
  startGoldLevel: 'START GOLD +30',
  kingHpLevel: 'KING HP +100',
  unitLimitLevel: 'UNIT LIMIT +1',
  autoRestartLevel: 'AUTO RESTART',
  speedLevel: 'SPEED LIMIT',
  pawnPowerLevel: '♙ PAWN POWER',
  rookPowerLevel: '♖ ROOK POWER',
  bishopPowerLevel: '♗ BISHOP POWER',
  knightPowerLevel: '♘ KNIGHT POWER',
  queenPowerLevel: '♕ QUEEN POWER',
};

export function createEscortTdRuntime(context: any) {
  const projectiles = createProjectileSystem(context.scene);
  const vipMesh = createVipMesh(context.scene);
  const coverageGuide = createCoverageGuide(context.scene);
  const rallyMarkers = createRallyMarkers(context.scene);
  const approachLines = new Map<string, Line>();
  const unitMeshes = new Map<number, any>();
  const guardHealthBars = new Map<number, { root: Group; fill: Mesh }>();
  const enemyMeshes = new Map<number, any>();
  const barricadeMeshes = new Map<number, any>();
  let latest: EscortTdStateSnapshot = context.initialState;
  let pollingTimer: number | null = null;
  let autoRestartTimer: number | null = null;
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

  function getKingBasis(): { x: number; z: number; nextX: number; nextZ: number } {
    return latest.king;
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
    setText('lifetime-kills', readCounter(LIFETIME_KILLS_STORAGE_KEY));
    setText('lifetime-score', readCounter(LIFETIME_SCORE_STORAGE_KEY));
    syncMetaPanel(Boolean(latest.result));
    syncSpeedPanel();
    syncRoutePanel();
  }

  function applyState(state: EscortTdStateSnapshot): void {
    latest = state;
    projectiles.syncState(state);
    if (state.result) recordResultChips(state);
    if (state.result && meta.autoRestartLevel > 0 && autoRestartTimer === null) {
      autoRestartTimer = window.setTimeout(() => {
        autoRestartTimer = null;
        void postAction({ action: 'restart', meta });
      }, 3500);
    } else if (!state.result && autoRestartTimer !== null) {
      window.clearTimeout(autoRestartTimer);
      autoRestartTimer = null;
    }
    vipMesh.position.set(state.king.x, CS * 0.36, state.king.z);
    syncCoverageGuide(coverageGuide, state);
    syncRallyMarkers(rallyMarkers, state);
    syncApproachPaths(approachLines, context.scene, state.approachPaths);
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
      mesh.visible = unit.respawnTimer <= 0;
      setEscortUnitAim(mesh, unit.aimFacing);
      syncGuardHealthBar(unit, guardHealthBars, context.scene);
    }
    for (const [id, mesh] of unitMeshes) {
      if (active.has(id)) continue;
      context.scene.remove(mesh);
      unitMeshes.delete(id);
      const healthBar = guardHealthBars.get(id);
      if (healthBar) {
        context.scene.remove(healthBar.root);
        guardHealthBars.delete(id);
      }
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
    const level = meta[key] as number;
    const cost = getEscortUpgradeCostByKey(key, level);
    const chips = readChipTotal();
    if (!latest.result || chips < cost || level >= getEscortMetaMaxLevel(key)) return;
    meta = { ...meta, [key]: level + 1 };
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
      const level = meta[key] as number;
      const cost = getEscortUpgradeCostByKey(key, level);
      const maxed = level >= getEscortMetaMaxLevel(key);
      button.textContent = maxed ? `${META_LABEL[key]}  MAX` : `${META_LABEL[key]}  Lv.${level}  [${cost} CHIP]`;
      button.disabled = !open || maxed || readChipTotal() < cost;
    }
  }

  function syncSpeedPanel(): void {
    const maxSpeed = latest.meta.speedLevel >= 2 ? 4 : latest.meta.speedLevel >= 1 ? 2 : 1;
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-speed]')) {
      const speed = Number(button.dataset.speed);
      button.disabled = speed > maxSpeed;
      button.dataset.active = String(speed === latest.timeScale);
    }
  }

  function syncRoutePanel(): void {
    const panel = document.getElementById('route-panel');
    if (!panel) return;
    const choice = latest.routeChoice;
    panel.dataset.open = String(choice !== null);
    if (!choice) return;
    setText('route-timer', `AUTO MAIN ROAD IN ${choice.remainingSeconds}s`);
    for (const option of choice.options) {
      const button = panel.querySelector(`[data-route="${option.id}"]`) as HTMLButtonElement | null;
      if (button) button.textContent = `${option.label}  ${option.distance}m`;
    }
  }

  function start(clock: Clock): void {
    applyState(latest);
    pollingTimer = window.setInterval(() => {
      void fetchState().catch((error: unknown) => console.error('Escort TD poll failed', error));
    }, 100);
    startAnimationFrameLoop({
      clock,
      step: (dt) => {
        context.controls.update();
        projectiles.tick(dt);
      },
      render: () => context.renderer.render(context.scene, context.camera),
    });
    window.addEventListener('beforeunload', () => {
      if (pollingTimer !== null) window.clearInterval(pollingTimer);
      if (autoRestartTimer !== null) window.clearTimeout(autoRestartTimer);
    }, { once: true });
    for (const key of Object.keys(META_LABEL) as Array<keyof EscortTdMetaProgress>) {
      document.querySelector(`[data-meta="${key}"]`)?.addEventListener('click', () => purchaseMetaUpgrade(key));
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-route]')) {
      button.addEventListener('click', () => {
        const route = button.dataset.route;
        if (route === 'direct' || route === 'detour') void postAction({ action: 'choose_route', route });
      });
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
    setRally: (role: EscortTdRallyRole, forward: number, side: number) => void postAction({ action: 'set_rally', role, forward, side }),
    getCommandMode,
    isKingPaused,
    isForceAdvance,
    getTimeScale,
    getKingBasis,
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

function createRallyMarkers(scene: any): Map<EscortTdRallyRole, Mesh> {
  const colors: Record<EscortTdRallyRole, number> = { left: 0x7cf7ff, right: 0xb4ff8b, rear: 0xffbc6b };
  const markers = new Map<EscortTdRallyRole, Mesh>();
  for (const role of Object.keys(colors) as EscortTdRallyRole[]) {
    const marker = new Mesh(
      new TorusGeometry(CS * 0.27, CS * 0.045, 6, 18),
      new MeshBasicMaterial({ color: colors[role], transparent: true, opacity: 0.72, depthWrite: false }),
    );
    marker.rotation.x = Math.PI / 2;
    marker.position.y = 0.14;
    scene.add(marker);
    markers.set(role, marker);
  }
  return markers;
}

function syncRallyMarkers(markers: Map<EscortTdRallyRole, Mesh>, state: EscortTdStateSnapshot): void {
  const dx = state.king.nextX - state.king.x;
  const dz = state.king.nextZ - state.king.z;
  const length = Math.hypot(dx, dz) || 1;
  const forward = { x: dx / length, z: dz / length };
  const side = { x: -forward.z, z: forward.x };
  for (const [role, marker] of markers) {
    const point = state.rallyPoints[role];
    marker.position.set(
      state.king.x + forward.x * CS * point.forward + side.x * CS * point.side,
      0.14,
      state.king.z + forward.z * CS * point.forward + side.z * CS * point.side,
    );
  }
}

function syncApproachPaths(lines: Map<string, Line>, scene: any, paths: EscortTdApproachPathSnapshot[]): void {
  const colors: Record<EscortTdApproachPathSnapshot['kind'], number> = { ground: 0xff5d43, siege: 0xffae5d, air: 0x65d9ff };
  const active = new Set<string>();
  for (const path of paths) {
    if (path.points.length < 2) continue;
    active.add(path.kind);
    let line = lines.get(path.kind);
    if (!line) {
      line = new Line(new BufferGeometry(), new LineBasicMaterial({ color: colors[path.kind], transparent: true, opacity: 0.32, depthWrite: false }));
      scene.add(line);
      lines.set(path.kind, line);
    }
    line.geometry.dispose();
    line.geometry = new BufferGeometry().setFromPoints(path.points.map((point) => new Vector3(point.x, 0.16, point.z)));
  }
  for (const [kind, line] of lines) {
    line.visible = active.has(kind);
  }
}

function syncGuardHealthBar(unit: EscortTdUnitSnapshot, bars: Map<number, { root: Group; fill: Mesh }>, scene: any): void {
  if (unit.type !== 'rook' && unit.type !== 'bishop' && unit.type !== 'knight') return;
  let bar = bars.get(unit.id);
  if (!bar) {
    const root = new Group();
    const width = CS * 0.72;
    root.add(new Mesh(new BoxGeometry(width, 0.1, 0.06), new MeshBasicMaterial({ color: 0x351111, depthWrite: false })));
    const fill = new Mesh(new BoxGeometry(width, 0.12, 0.07), new MeshBasicMaterial({ color: 0x79ff7c, depthWrite: false }));
    root.add(fill);
    scene.add(root);
    bar = { root, fill };
    bars.set(unit.id, bar);
  }
  const ratio = Math.max(0, Math.min(1, unit.hp / unit.hpMax));
  bar.root.visible = unit.respawnTimer <= 0;
  bar.root.position.set(unit.wx, CS * 1.15, unit.wz);
  bar.fill.scale.x = ratio;
  bar.fill.position.x = (ratio - 1) * CS * 0.36;
  (bar.fill.material as MeshBasicMaterial).color.set(ratio > 0.5 ? 0x79ff7c : 0xff8b5c);
}

function readChipTotal(): number {
  return readCounter(CHIP_TOTAL_STORAGE_KEY);
}

function readCounter(key: string): number {
  const value = Number.parseInt(localStorage.getItem(key) ?? '0', 10);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function recordResultChips(state: EscortTdStateSnapshot): void {
  const result = state.result;
  if (!result) return;
  const key = `${CHIP_RESULT_STORAGE_PREFIX}${state.citySeed}:${result.outcome}:${result.progressPercent}:${result.score}:${result.kills.ground}:${result.kills.air}:${result.kills.siege}`;
  if (localStorage.getItem(key) === 'recorded') return;
  const killCount = result.kills.ground + result.kills.air + result.kills.siege;
  localStorage.setItem(CHIP_TOTAL_STORAGE_KEY, String(readChipTotal() + result.chips));
  localStorage.setItem(LIFETIME_KILLS_STORAGE_KEY, String(readCounter(LIFETIME_KILLS_STORAGE_KEY) + killCount));
  localStorage.setItem(LIFETIME_SCORE_STORAGE_KEY, String(readCounter(LIFETIME_SCORE_STORAGE_KEY) + result.score));
  localStorage.setItem(key, 'recorded');
}

function readMetaProgress(): EscortTdMetaProgress {
  try {
    const stored = JSON.parse(localStorage.getItem(META_STORAGE_KEY) ?? '{}') as Partial<EscortTdMetaProgress>;
    return {
      startGoldLevel: validMetaLevel(stored.startGoldLevel),
      kingHpLevel: validMetaLevel(stored.kingHpLevel),
      unitLimitLevel: validMetaLevel(stored.unitLimitLevel),
      autoRestartLevel: validMetaLevel(stored.autoRestartLevel),
      speedLevel: Math.min(2, validMetaLevel(stored.speedLevel)),
      pawnPowerLevel: Math.min(10, validMetaLevel(stored.pawnPowerLevel)),
      rookPowerLevel: Math.min(10, validMetaLevel(stored.rookPowerLevel)),
      bishopPowerLevel: Math.min(10, validMetaLevel(stored.bishopPowerLevel)),
      knightPowerLevel: Math.min(10, validMetaLevel(stored.knightPowerLevel)),
      queenPowerLevel: Math.min(10, validMetaLevel(stored.queenPowerLevel)),
    };
  } catch {
    return { startGoldLevel: 0, kingHpLevel: 0, unitLimitLevel: 0, autoRestartLevel: 0, speedLevel: 0, pawnPowerLevel: 0, rookPowerLevel: 0, bishopPowerLevel: 0, knightPowerLevel: 0, queenPowerLevel: 0 };
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
