export type NetworkDefenseVisualAdapter = {
  createPacket: (color: number, radius: number) => any;
  createAgent: (rank: string, position: any) => any;
  move: (handle: any, position: any) => void;
  rotateAgent: (handle: any, dt: number, working: boolean) => void;
  destroyPacket: (handle: any) => void;
  createFirewall: (edge: any) => any;
  updateFirewall: (handle: any, now: number) => void;
  destroyFirewall: (handle: any) => void;
  updateNode: (node: any, now: number) => void;
};

export const nullNetworkDefenseVisualAdapter: NetworkDefenseVisualAdapter = {
  createPacket: () => null,
  createAgent: () => null,
  move: () => {},
  rotateAgent: () => {},
  destroyPacket: () => {},
  createFirewall: () => null,
  updateFirewall: () => {},
  destroyFirewall: () => {},
  updateNode: () => {},
};
