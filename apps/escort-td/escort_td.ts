import { Clock, } from 'three';
import { D4, GW, GH, buildCity } from './escort_td_core.js';
import { createEscortTdRuntime } from './escort_td_runtime.js';
import { bindEscortTdInputs, createEscortTdScene } from './escort_td_scene.js';

const seed = Date.now() & 0xffffff;
const city = buildCity(GW, GH, seed);
const sceneState = createEscortTdScene(city, seed);
const runtime = createEscortTdRuntime({
  city,
  d4: D4,
  ...sceneState,
});

bindEscortTdInputs({
  camera: sceneState.camera,
  renderer: sceneState.renderer,
  onPlaceUnit: runtime.placeUnit,
  getCommandMode: runtime.getCommandMode,
  onCommandModeChange: runtime.setCommandMode,
  onRestart: runtime.restartIfFinished,
});

runtime.start(new Clock());
