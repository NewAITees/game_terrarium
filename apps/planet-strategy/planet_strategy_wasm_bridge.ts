interface PlanetStrategyWasmModule {
  default: () => Promise<unknown>;
  scoreAttackTargets: (payload: unknown) => { best_index?: number | null };
  stepPlanetStrategyMissiles: (payload: unknown) => { missiles: Array<{ id: string; x: number; y: number; z: number; life: number; reached: boolean }> };
  stepPlanetStrategyShips: (payload: unknown) => {
    ships: Array<{
      id: string;
      x: number;
      y: number;
      z: number;
      status: string;
      progress: number;
      launch_timer: number;
      orbit_angle: number;
      home_planet_id: string;
      from_planet_id: string;
      to_planet_id: string;
      target_planet_id: string | null;
      fire_cooldown: number;
    }>;
  };
}

type PlanetStrategyWasmState = {
  mod: PlanetStrategyWasmModule | null;
  initPromise: Promise<boolean> | null;
};

const wasmState: PlanetStrategyWasmState = {
  mod: null,
  initPromise: null,
};

export function initPlanetStrategyWasm(): Promise<boolean> {
  if (wasmState.mod) return Promise.resolve(true);
  if (wasmState.initPromise) return wasmState.initPromise;

  // @ts-ignore — served at runtime by Express, not resolvable at compile time
  wasmState.initPromise = import('/_vendor/wasm/network_core_wasm.js')
    .then(async (mod: unknown) => {
      const typed = mod as PlanetStrategyWasmModule;
      await typed.default();
      wasmState.mod = typed;
      return true;
    })
    .catch(() => false)
    .finally(() => {
      wasmState.initPromise = null;
    });

  return wasmState.initPromise;
}

export function isPlanetStrategyWasmReady(): boolean {
  return wasmState.mod !== null;
}

export function scoreAttackTargets(payload: unknown): { best_index?: number | null } | null {
  if (!wasmState.mod) return null;
  return wasmState.mod.scoreAttackTargets(payload);
}

export function stepPlanetStrategyMissiles(payload: unknown): { missiles: Array<{ id: string; x: number; y: number; z: number; life: number; reached: boolean }> } | null {
  if (!wasmState.mod) return null;
  return wasmState.mod.stepPlanetStrategyMissiles(payload);
}

export function stepPlanetStrategyShips(payload: unknown): { ships: Array<{
  id: string;
  x: number;
  y: number;
  z: number;
  status: string;
  progress: number;
  launch_timer: number;
  orbit_angle: number;
  home_planet_id: string;
  from_planet_id: string;
  to_planet_id: string;
  target_planet_id: string | null;
  fire_cooldown: number;
}> } | null {
  if (!wasmState.mod) return null;
  return wasmState.mod.stepPlanetStrategyShips(payload);
}

void initPlanetStrategyWasm();
