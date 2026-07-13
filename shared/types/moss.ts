export type MossNodeType = 'terminal' | 'router' | 'switch';

export type MossNodeSpin = {
  x: number;
  y: number;
  z: number;
};

export type MossNodeSnapshot = {
  id: number;
  type: MossNodeType;
  x: number;
  y: number;
  z: number;
  spin: MossNodeSpin;
};

export type MossEdgeSnapshot = {
  a: number;
  b: number;
};

export type MossPacketSnapshot = {
  id: number;
  color: number;
  startId: number;
  endId: number;
  t: number;
};

export type MossStateSnapshot = {
  page: 'moss';
  seed: number;
  elapsed: number;
  nodeCount: number;
  edgeCount: number;
  packetCount: number;
  nodes: MossNodeSnapshot[];
  edges: MossEdgeSnapshot[];
  packets: MossPacketSnapshot[];
  activeEdgeKeys: string[];
  typeCounts: Record<MossNodeType, number>;
  avgDegree: number;
};
