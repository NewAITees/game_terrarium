import { Mesh,MeshBasicMaterial,SphereGeometry, } from 'three';
import { RNG, edgeKey } from './network-core-topology.js';

export function spawnPacket(packet: any, terms: any[], server: any, routeFn: any, rng: RNG) {
  const src = rng.pick(terms);
  const dst = rng.next() < .8 ? server : (() => {
    let d;
    do { d = rng.pick(terms); } while (d === src);
    return d;
  })();
  let path = routeFn(src, dst);
  if (rng.next() < .5) path = [...path].reverse();
  packet.path = path;
  packet.seg = 0;
  packet.t = rng.next();
  packet.speed = .3 + rng.next() * .35;
}

export function buildPackets(count: number, scene: any, topo: any, seed: number, routeFn: any) {
  const colors = [0xFFD060, 0x38aaff, 0xffffff, 0x44ffaa, 0xff8855];
  const rng = new RNG(seed);
  const terms = topo.lnodes.term;
  const packets = Array.from({ length: count }, () => {
    const mesh = new Mesh(
      new SphereGeometry(.37, 7, 7),
      new MeshBasicMaterial({ color: colors[rng.int(0, colors.length - 1)] })
    );
    scene.add(mesh);
    const packet = { mesh, path: [], seg: 0, t: rng.next(), speed: .3 };
    spawnPacket(packet, terms, topo.server, routeFn, rng);
    return packet;
  });
  const respawn = (packet: any) => spawnPacket(packet, terms, topo.server, routeFn, rng);
  return { packets, respawn };
}

export function tickPackets(packets: any[], respawn: any, edgeMap: Map<string, any>, glowMap: Map<number, number>, dt: number, now: number) {
  for (const packet of packets) {
    packet.t += dt * packet.speed;
    if (packet.t >= 1) {
      const arrived = packet.path[packet.seg + 1];
      if (arrived) glowMap.set(arrived.id, 1.0);
      packet.t = 0;
      packet.seg++;
      if (packet.seg >= packet.path.length - 1) {
        respawn(packet);
        continue;
      }
    }
    const a = packet.path[packet.seg];
    const b = packet.path[packet.seg + 1];
    if (!a || !b) {
      respawn(packet);
      continue;
    }
    const edge = edgeMap.get(edgeKey(a.id, b.id));
    if (!edge) {
      respawn(packet);
      continue;
    }
    packet.mesh.position.copy(edge.curve.getPoint(edge.an === a ? packet.t : 1 - packet.t));
    edge.activeUntil = Math.max(edge.activeUntil, now + .3);
  }
}
