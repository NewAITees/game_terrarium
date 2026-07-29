import { Clock } from 'three';
import { GW, GH, buildCity } from './escort_td_core.js';
import { createEscortTdRuntime } from './escort_td_runtime.js';
import { bindEscortTdInputs, createEscortTdScene } from './escort_td_scene.js';
import type { EscortTdStateSnapshot } from '../../shared/types/escort_td.js';

async function bootstrap(): Promise<void> {
  const response = await fetch('/api/escort-td/state');
  if (!response.ok) throw new Error(`escort_td bootstrap failed: ${response.status}`);
  const initialState = await response.json() as EscortTdStateSnapshot;
  const city = buildCity(GW, GH, initialState.citySeed);
  const sceneState = createEscortTdScene(city, initialState.citySeed);
  const runtime = createEscortTdRuntime({
    city,
    initialState,
    ...sceneState,
  });

  bindEscortTdInputs({
    camera: sceneState.camera,
    city,
    renderer: sceneState.renderer,
    scene: sceneState.scene,
    onPlaceUnit: runtime.placeUnit,
    onPlaceBarricade: runtime.placeBarricade,
    onReclaimAt: runtime.reclaimAt,
    onDeployFromKing: runtime.deployFromKing,
    onToggleKingPause: runtime.toggleKingPause,
    onToggleForceAdvance: runtime.toggleForceAdvance,
    getCommandMode: runtime.getCommandMode,
    isKingPaused: runtime.isKingPaused,
    isForceAdvance: runtime.isForceAdvance,
    getTimeScale: runtime.getTimeScale,
    onTimeScaleChange: runtime.setTimeScale,
    getKingBasis: runtime.getKingBasis,
    onSetRally: runtime.setRally,
    onCommandModeChange: runtime.setCommandMode,
    onRestart: runtime.restartIfFinished,
  });

  runtime.start(new Clock());
}

void bootstrap().catch((error: unknown) => {
  console.error('Escort TD bootstrap failed', error);
});
