import { RNG } from '../shared/network-core-topology';
import type {
  MossEdgeSnapshot,
  MossNodeSnapshot,
  MossNodeSpin,
  MossNodeType,
  MossPacketSnapshot,
  MossStateSnapshot,
} from '../shared/types/moss';

const CONFIG = {
  nodeCount: 14,
  packetCount: 30,
  packetSpeed: 0.35,
} as const;

const PACKET_COLORS = [0x67ffb1, 0x7bd4ff, 0xffffff, 0x44ffaa, 0xffd060];

type RuntimeNode = MossNodeSnapshot & {
  neighbors: number[];
};

type RuntimePacket = {
  id: number;
  color: number;
  startId: number;
  endId: number;
  t: number;
  speed: number;
};

export class MossRuntime {
  private readonly seed: number;
  private readonly rng: RNG;
  private readonly routeRng: RNG;
  private readonly nodes: RuntimeNode[] = [];
  private readonly edges: MossEdgeSnapshot[] = [];
  private readonly packets: RuntimePacket[] = [];
  private readonly activeEdgeTtls = new Map<string, number>();
  private readonly typeCounts: Record<MossNodeType, number> = {
    terminal: 0,
    router: 0,
    switch: 0,
  };
  private elapsed = 0;
  private lastTickAt = Date.now();

  constructor(config?: { seed?: number; nodeCount?: number; packetCount?: number }) {
    const nodeCount = config?.nodeCount ?? CONFIG.nodeCount;
    const packetCount = config?.packetCount ?? CONFIG.packetCount;
    this.seed = config?.seed ?? ((Math.random() * 1e9) | 0);
    this.rng = new RNG(this.seed + 1);
    this.routeRng = new RNG(this.seed + 2);

    this.buildNodes(nodeCount);
    this.buildEdges();
    this.buildPackets(packetCount);
  }

  getSnapshot(): MossStateSnapshot {
    this.tickToNow();
    const avgDegree = Number(((this.edges.length * 2) / Math.max(1, this.nodes.length)).toFixed(2));
    return {
      page: 'moss',
      seed: this.seed,
      elapsed: Number(this.elapsed.toFixed(3)),
      nodeCount: this.nodes.length,
      edgeCount: this.edges.length,
      packetCount: this.packets.length,
      nodes: this.nodes.map(({ neighbors: _neighbors, ...node }) => ({
        ...node,
        spin: { ...node.spin },
      })),
      edges: this.edges.map((edge) => ({ ...edge })),
      packets: this.packets.map((packet): MossPacketSnapshot => ({
        id: packet.id,
        color: packet.color,
        startId: packet.startId,
        endId: packet.endId,
        t: packet.t,
      })),
      activeEdgeKeys: [...this.activeEdgeTtls.keys()],
      typeCounts: { ...this.typeCounts },
      avgDegree,
    };
  }

  private buildNodes(nodeCount: number): void {
    for (let i = 0; i < nodeCount; i += 1) {
      const type = this.randomNodeType();
      const spin: MossNodeSpin = {
        x: this.rng.range(-0.45, 0.45),
        y: this.rng.range(-0.7, 0.7),
        z: this.rng.range(-0.45, 0.45),
      };
      const node: RuntimeNode = {
        id: i,
        type,
        x: this.rng.range(-30, 30),
        y: 0,
        z: this.rng.range(-30, 30),
        spin,
        neighbors: [],
      };
      this.nodes.push(node);
      this.typeCounts[type] += 1;
    }
  }

  private buildEdges(): void {
    const connected = new Set<string>();
    for (let i = 1; i < this.nodes.length; i += 1) {
      const j = this.rng.int(0, i - 1);
      this.connectNodes(i, j, connected);
    }

    const extraEdgeCount = Math.floor(this.nodes.length * 1.2);
    let safety = 0;
    while (this.edges.length < this.nodes.length - 1 + extraEdgeCount && safety < 1000) {
      safety += 1;
      const a = this.rng.int(0, this.nodes.length - 1);
      const b = this.rng.int(0, this.nodes.length - 1);
      if (a === b) continue;
      this.connectNodes(a, b, connected);
    }
  }

  private buildPackets(packetCount: number): void {
    for (let i = 0; i < packetCount; i += 1) {
      const packet: RuntimePacket = {
        id: i,
        color: PACKET_COLORS[this.rng.int(0, PACKET_COLORS.length - 1)],
        startId: 0,
        endId: 0,
        t: this.rng.next(),
        speed: CONFIG.packetSpeed,
      };
      this.respawnPacket(packet);
      this.packets.push(packet);
    }
  }

  private tickToNow(): void {
    const now = Date.now();
    const dt = Math.min((now - this.lastTickAt) / 1000, 0.05);
    this.lastTickAt = now;
    if (dt > 0) this.tick(dt);
  }

  private tick(dt: number): void {
    this.elapsed += dt;

    for (const [key, ttl] of [...this.activeEdgeTtls.entries()]) {
      const next = ttl - dt;
      if (next <= 0) this.activeEdgeTtls.delete(key);
      else this.activeEdgeTtls.set(key, next);
    }

    for (const packet of this.packets) {
      packet.t += dt * packet.speed;
      while (packet.t >= 1) {
        packet.t -= 1;
        const arrived = this.getNode(packet.endId);
        this.activeEdgeTtls.set(this.edgeKey(packet.startId, packet.endId), 0.3);
        packet.startId = arrived.id;
        packet.endId = this.pickNextHop(arrived.id);
        if (packet.startId === packet.endId) {
          this.respawnPacket(packet);
          break;
        }
      }

      if (!this.hasNode(packet.startId) || !this.hasNode(packet.endId)) {
        this.respawnPacket(packet);
        continue;
      }
      this.activeEdgeTtls.set(this.edgeKey(packet.startId, packet.endId), 0.3);
    }
  }

  private respawnPacket(packet: RuntimePacket): void {
    const start = this.pickNode();
    const end = this.pickNextHop(start.id);
    packet.startId = start.id;
    packet.endId = end;
    packet.t = this.routeRng.next();
    packet.speed = CONFIG.packetSpeed + this.routeRng.next() * 0.4;
  }

  private pickNode(): RuntimeNode {
    return this.nodes[this.routeRng.int(0, this.nodes.length - 1)];
  }

  private pickNextHop(nodeId: number): number {
    const node = this.getNode(nodeId);
    if (!node.neighbors.length) {
      const fallback = this.pickNode().id;
      return fallback === nodeId ? (nodeId + 1) % this.nodes.length : fallback;
    }
    const next = node.neighbors[this.routeRng.int(0, node.neighbors.length - 1)];
    return next === nodeId ? (next + 1) % this.nodes.length : next;
  }

  private connectNodes(aIndex: number, bIndex: number, connected: Set<string>): void {
    if (aIndex === bIndex) return;
    const key = this.edgeKey(aIndex, bIndex);
    if (connected.has(key)) return;
    connected.add(key);
    this.edges.push({ a: aIndex, b: bIndex });
    this.getNode(aIndex).neighbors.push(bIndex);
    this.getNode(bIndex).neighbors.push(aIndex);
  }

  private randomNodeType(): MossNodeType {
    const roll = this.rng.next();
    if (roll < 0.5) return 'terminal';
    if (roll < 0.85) return 'router';
    return 'switch';
  }

  private getNode(id: number): RuntimeNode {
    const node = this.nodes[id];
    if (!node) throw new Error(`unknown node id: ${id}`);
    return node;
  }

  private hasNode(id: number): boolean {
    return Boolean(this.nodes[id]);
  }

  private edgeKey(a: number, b: number): string {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
  }
}
