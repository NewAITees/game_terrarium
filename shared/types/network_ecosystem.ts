export interface EcosystemTotals {
  resource: number;
  threat: number;
  immune: number;
  carnivore: number;
}

export interface EcosystemHotspot {
  id: number;
  layer: string;
  resource: number;
  threat: number;
  immune: number;
  carnivore: number;
}

export interface EcosystemSnapshot {
  elapsed: number;
  mode: 'immune' | 'threat';
  nodes: number;
  balance: number;
  idealBalanceRange: [number, number];
  avgResource: number;
  avgThreat: number;
  avgImmune: number;
  avgCarnivore: number;
  activeNodes: number;
  coexistNodes: number;
  activePulses: number;
  hotspots: EcosystemHotspot[];
}

export interface EcosystemGameState {
  mode: 'immune' | 'threat';
  elapsed: number;
  nextPulse: number;
  nextCarnivore: number;
  nextStress: number;
}

export interface EcosystemPulse {
  mesh: any;
  edge: any;
  from: any;
  t: number;
  speed: number;
  pulseType: 'threat' | 'carnivore' | 'immune';
}

export interface EcosystemRuntimeContext {
  topo: any;
  adj: Map<number, any[]>;
  rng: any;
  edgeMap: Map<string, any>;
  scene: any;
  pulses: EcosystemPulse[];
  game: EcosystemGameState;
}
