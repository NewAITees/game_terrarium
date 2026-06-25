import { RNG, buildTopology, edgeKey, findShortestPath } from '../shared/network-core-topology';
import type {
  NetworkSmallWorldEdgeSnapshot,
  NetworkSmallWorldNodeSnapshot,
  NetworkSmallWorldPacketSnapshot,
  NetworkSmallWorldStateSnapshot,
} from '../shared/types/network_smallworld';

type RuntimeNode = {
  id: number;
  layer: 'core' | 'dist' | 'acc' | 'term';
  x: number;
  y: number;
  z: number;
  isServer: boolean;
};

type RuntimePacket = {
  id: number;
  color: number;
  path: RuntimeNode[];
  seg: number;
  t: number;
  speed: number;
};

const PACKET_COLORS = [0xffd060, 0x38aaff, 0xffffff, 0x44ffaa, 0xff8855];

export class NetworkSmallWorldRuntime {
  private readonly total: number;
  private readonly seed: number;
  private readonly rewirePct: number;
  private readonly packetCount: number;
  private readonly rng: RNG;
  private readonly routeRng: RNG;
  private readonly nodes: RuntimeNode[];
  private readonly edges: NetworkSmallWorldEdgeSnapshot[];
  private readonly terms: RuntimeNode[];
  private readonly serverNode: RuntimeNode;
  private readonly adj = new Map<number, RuntimeNode[]>();
  private readonly activeEdgeTtls = new Map<string, number>();
  private readonly glowByNode = new Map<number, number>();
  private readonly packets: RuntimePacket[];
  private elapsed = 0;
  private lastTickAt = Date.now();

  constructor(config?: { total?: number; seed?: number; rewirePct?: number; packetCount?: number }) {
    this.total = config?.total ?? 32;
    this.seed = config?.seed ?? (Math.random() * 1e9) | 0;
    this.rewirePct = config?.rewirePct ?? 28;
    this.packetCount = config?.packetCount ?? 55;
    this.rng = new RNG(this.seed + 1);
    this.routeRng = new RNG(this.seed + 2);

    const topo = buildTopology(this.total, this.seed, 'smallworld', this.rewirePct);
    this.nodes = topo.nodes.map((node: any) => ({
      id: node.id,
      layer: node.layer,
      x: node.x,
      y: node.y,
      z: node.z,
      isServer: Boolean(node.isServer),
    }));
    this.serverNode = this.nodes.find((node) => node.isServer) ?? this.nodes[0];
    this.terms = this.nodes.filter((node) => node.layer === 'term');
    this.edges = [
      ...topo.treeEdges.map((edge: any) => ({ a: edge.a.id, b: edge.b.id, shortcut: false })),
      ...topo.shortcutEdges.map((edge: any) => ({ a: edge.a.id, b: edge.b.id, shortcut: true })),
    ];

    for (const node of this.nodes) this.adj.set(node.id, []);
    for (const edge of this.edges) {
      const a = this.getNode(edge.a);
      const b = this.getNode(edge.b);
      this.adj.get(a.id)?.push(b);
      this.adj.get(b.id)?.push(a);
    }

    this.packets = Array.from({ length: this.packetCount }, (_, id) => {
      const packet: RuntimePacket = {
        id,
        color: PACKET_COLORS[this.rng.int(0, PACKET_COLORS.length - 1)],
        path: [],
        seg: 0,
        t: this.rng.next(),
        speed: 0.3,
      };
      this.respawnPacket(packet);
      return packet;
    });
  }

  tickToNow(): void {
    const now = Date.now();
    const dt = Math.min((now - this.lastTickAt) / 1000, 0.05);
    this.lastTickAt = now;
    if (dt > 0) this.tick(dt);
  }

  getSnapshot(): NetworkSmallWorldStateSnapshot {
    this.tickToNow();
    return {
      page: 'network_smallworld',
      mode: 'smallworld',
      seed: this.seed,
      total: this.total,
      rewirePct: this.rewirePct,
      elapsed: Number(this.elapsed.toFixed(3)),
      serverNodeId: this.serverNode.id,
      treeEdgeCount: this.edges.filter((edge) => !edge.shortcut).length,
      shortcutEdgeCount: this.edges.filter((edge) => edge.shortcut).length,
      nodes: this.nodes.map((node): NetworkSmallWorldNodeSnapshot => ({ ...node })),
      edges: this.edges.map((edge) => ({ ...edge })),
      packets: this.packets
        .map((packet): NetworkSmallWorldPacketSnapshot | null => {
          const from = packet.path[packet.seg];
          const to = packet.path[packet.seg + 1];
          if (!from || !to) return null;
          return {
            id: packet.id,
            color: packet.color,
            fromId: from.id,
            toId: to.id,
            t: packet.t,
          };
        })
        .filter((packet): packet is NetworkSmallWorldPacketSnapshot => packet !== null),
      activeEdgeKeys: [...this.activeEdgeTtls.keys()],
      glowNodes: [...this.glowByNode.entries()].map(([id, intensity]) => ({ id, intensity })),
    };
  }

  private tick(dt: number): void {
    this.elapsed += dt;

    for (const [key, ttl] of [...this.activeEdgeTtls.entries()]) {
      const next = ttl - dt;
      if (next <= 0) this.activeEdgeTtls.delete(key);
      else this.activeEdgeTtls.set(key, next);
    }

    for (const [id, intensity] of [...this.glowByNode.entries()]) {
      const next = Math.max(0, intensity - dt * 4);
      if (next <= 0.005) this.glowByNode.delete(id);
      else this.glowByNode.set(id, next);
    }

    for (const packet of this.packets) {
      packet.t += dt * packet.speed;
      while (packet.t >= 1) {
        const arrived = packet.path[packet.seg + 1];
        if (arrived) this.glowByNode.set(arrived.id, 1);
        packet.t -= 1;
        packet.seg += 1;
        if (packet.seg >= packet.path.length - 1) {
          this.respawnPacket(packet);
          break;
        }
      }

      const from = packet.path[packet.seg];
      const to = packet.path[packet.seg + 1];
      if (!from || !to) {
        this.respawnPacket(packet);
        continue;
      }
      this.activeEdgeTtls.set(edgeKey(from.id, to.id), 0.3);
    }
  }

  private respawnPacket(packet: RuntimePacket): void {
    const src = this.pickTerm();
    const dst = this.routeRng.next() < 0.8 ? this.serverNode : this.pickOtherTerm(src.id);
    let path = this.findRoute(src, dst);
    if (this.routeRng.next() < 0.5) path = [...path].reverse();
    packet.path = path;
    packet.seg = 0;
    packet.t = this.routeRng.next();
    packet.speed = 0.3 + this.routeRng.next() * 0.35;
  }

  private findRoute(from: RuntimeNode, to: RuntimeNode): RuntimeNode[] {
    return findShortestPath(from, to, this.adj);
  }

  private pickTerm(): RuntimeNode {
    return this.terms[this.routeRng.int(0, this.terms.length - 1)];
  }

  private pickOtherTerm(id: number): RuntimeNode {
    let node = this.pickTerm();
    while (node.id === id && this.terms.length > 1) node = this.pickTerm();
    return node;
  }

  private getNode(id: number): RuntimeNode {
    const node = this.nodes.find((entry) => entry.id === id);
    if (!node) throw new Error(`unknown node id: ${id}`);
    return node;
  }
}
