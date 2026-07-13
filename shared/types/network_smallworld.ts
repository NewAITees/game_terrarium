export type NetworkSmallWorldLayer = 'core' | 'dist' | 'acc' | 'term';

export type NetworkSmallWorldNodeSnapshot = {
  id: number;
  layer: NetworkSmallWorldLayer;
  x: number;
  y: number;
  z: number;
  isServer: boolean;
};

export type NetworkSmallWorldEdgeSnapshot = {
  a: number;
  b: number;
  shortcut: boolean;
};

export type NetworkSmallWorldPacketSnapshot = {
  id: number;
  color: number;
  fromId: number;
  toId: number;
  t: number;
};

export type NetworkSmallWorldStateSnapshot = {
  page: 'network_smallworld';
  mode: 'smallworld';
  seed: number;
  total: number;
  rewirePct: number;
  elapsed: number;
  serverNodeId: number;
  treeEdgeCount: number;
  shortcutEdgeCount: number;
  nodes: NetworkSmallWorldNodeSnapshot[];
  edges: NetworkSmallWorldEdgeSnapshot[];
  packets: NetworkSmallWorldPacketSnapshot[];
  activeEdgeKeys: string[];
  glowNodes: Array<{ id: number; intensity: number }>;
};
