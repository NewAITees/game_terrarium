export type ColonyPersonality = 'builder' | 'raider' | 'hoarder';
export type ColonyInterventionType = 'resource_drop' | 'storm' | 'invader_wave' | 'spawn_neutral';
export type ColonyAction = 'expand' | 'attack' | 'fortify' | 'gather';

export interface ColonyNode {
  id: number;
  x: number;
  z: number;
  owner: number;
  strength: number;
  food: number;
  material: number;
  foodRate: number;
  isBase: boolean;
  neighbors: ColonyNode[];
  flashUntil: number;
  mesh: any | null;
  halo: any | null;
  resourceRing: any | null;
}

export interface ColonyEdge {
  a: ColonyNode;
  b: ColonyNode;
  line: any | null;
}

export interface ColonyMap {
  nodes: ColonyNode[];
  edges: ColonyEdge[];
}

export interface ColonyRule {
  id: string;
  when?: string;
  action: ColonyAction;
}

export interface ColonyFactionDef {
  id: number;
  name: string;
  personality: ColonyPersonality;
  color: number;
  emCol: number;
}

export interface ColonyFaction extends ColonyFactionDef {
  food: number;
  material: number;
  nodes: ColonyNode[];
  baseNode: ColonyNode | null;
  intent: string;
  alive: boolean;
  rules: ColonyRule[];
}

export interface ColonyWorldState {
  elapsed: number;
  tickTimer: number;
  tick: number;
  eventTimer: number;
}

export interface ColonyTelemetryFaction {
  id: number;
  name: string;
  personality: ColonyPersonality;
  alive: boolean;
  territory: number;
  food: number;
  material: number;
  intent: string;
}

export interface ColonyInterventionItem {
  type: ColonyInterventionType;
}
