export type NetworkDefenseRank = 'senior' | 'mid' | 'junior';

export interface NetworkDefenseNode {
  id?: string;
  x: number;
  y: number;
  z: number;
  layer?: string;
  isServer?: boolean;
  hp?: number;
  maxHp?: number;
  infection?: number;
  hardenUntil?: number;
  rebootUntil?: number;
  targetedUntil?: number;
  material?: any;
  halo?: any;
  mesh?: any;
  [key: string]: any;
}

export interface NetworkDefenseTopology {
  nodes: NetworkDefenseNode[];
  lnodes: Record<string, NetworkDefenseNode[]>;
  [key: string]: any;
}

export interface NetworkDefenseRule {
  action: string;
  [key: string]: any;
}

export interface NetworkDefensePersonality {
  key: string;
  label: string;
  summary: string;
  priorities: string[];
}

export interface NetworkDefenseAgent {
  rank: NetworkDefenseRank;
  state?: string;
  arrivalAction?: string;
  actionKey?: string;
  personality?: NetworkDefensePersonality;
  [key: string]: any;
}

export interface NetworkDefenseObserverSnapshot {
  rank: NetworkDefenseRank;
  personality: string;
  summary: string;
  intent: string;
}

export interface NetworkDefenseObserverHotspot {
  label: string;
  value: string;
}

export interface NetworkDefenseObserverSummary {
  text: string;
  detail: string;
}

export interface NetworkDefenseObserverHudState {
  lowLoadMode: boolean;
  eventState: {
    label: string;
    detail: string;
  };
  rankSnapshots: NetworkDefenseObserverSnapshot[];
  summary: NetworkDefenseObserverSummary;
  hotspots: NetworkDefenseObserverHotspot[];
}

export interface NetworkDefenseGameState {
  environmentSpeedMultiplier: number;
  credits: number;
  lowLoadMode?: boolean;
  rankIntents?: Record<string, string>;
  lastRecruitTime?: number;
  [key: string]: any;
}

export interface NetworkDefenseObserverEventState {
  active: null | {
    key: string;
    label: string;
    summary: string;
    until: number;
    targets: NetworkDefenseNode[];
  };
  remaining: number;
  label: string;
  summary: string;
}
