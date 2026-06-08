import * as THREE from 'three';
import { STYLE, edgeKey } from './network-core-topology.js';

export function buildScene(topo: any, scene: any, spinData?: any[]) {
  for (const node of topo.nodes) {
    const sk = node.isServer ? 'server' : node.layer;
    const style = STYLE[sk];
    const mat = new THREE.MeshStandardMaterial({
      color: style.color,
      emissive: style.em,
      emissiveIntensity: style.emI,
      metalness: 0.45,
      roughness: 0.25,
    });
    const mesh = new THREE.Mesh(style.geo(), mat);
    mesh.position.set(node.x, node.y, node.z);
    mesh.add(new THREE.Mesh(
      new THREE.SphereGeometry(style.halo, 12, 12),
      new THREE.MeshBasicMaterial({ color: style.color, transparent: true, opacity: style.hOp, side: THREE.BackSide })
    ));
    scene.add(mesh);
    node.mesh = mesh;
    if (spinData) spinData.push({ mesh, s: style });
  }

  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.6, .07, 6, 22),
      new THREE.MeshBasicMaterial({ color: 0xFFD060, transparent: true, opacity: .3 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(topo.server.x, topo.server.y - 1.5 + i * 1.5, topo.server.z);
    scene.add(ring);
  }

  const serverGlow = new THREE.PointLight(0xFFD060, 3.5, 80);
  serverGlow.position.set(topo.server.x, topo.server.y + 5, topo.server.z);
  scene.add(serverGlow);
  return serverGlow;
}

export function makeMats() {
  return {
    tA: new THREE.LineBasicMaterial({ color: 0x88ddff, transparent: true, opacity: 1.0 }),
    tI: new THREE.LineBasicMaterial({ color: 0x0d1e33, transparent: true, opacity: 0.2 }),
    sA: new THREE.LineDashedMaterial({ color: 0xff8833, dashSize: 3, gapSize: 1, transparent: true, opacity: 1.0 }),
    sI: new THREE.LineDashedMaterial({ color: 0x401508, dashSize: 3, gapSize: 1, transparent: true, opacity: 0.45 }),
  };
}

export function buildEdges(topo: any, scene: any, edgeMap: Map<string, any>, allEdges: any[], mats: any) {
  function add(a: any, b: any, shortcut: boolean) {
    const p0 = new THREE.Vector3(a.x, a.y, a.z);
    const p2 = new THREE.Vector3(b.x, b.y, b.z);
    const mid = p0.clone().lerp(p2, .5);
    mid.y += shortcut ? 22 : 6;
    const curve = new THREE.QuadraticBezierCurve3(p0, mid, p2);
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(70));
    const line = new THREE.Line(geo, shortcut ? mats.sI : mats.tI);
    if (shortcut) line.computeLineDistances();
    scene.add(line);
    const edge = { line, curve, an: a, bn: b, activeUntil: 0, shortcut };
    allEdges.push(edge);
    edgeMap.set(edgeKey(a.id, b.id), edge);
  }

  topo.treeEdges.forEach((edge: any) => add(edge.a, edge.b, false));
  topo.shortcutEdges.forEach((edge: any) => add(edge.a, edge.b, true));
}

export function tickEdges(allEdges: any[], mats: any, now: number) {
  for (const edge of allEdges) {
    edge.line.material = edge.activeUntil > now
      ? (edge.shortcut ? mats.sA : mats.tA)
      : (edge.shortcut ? mats.sI : mats.tI);
  }
}

export function initFlash(nodes: any[]) { return new Map(nodes.map((node) => [node.id, 0])); }

export function tickFlash(nodes: any[], glowMap: Map<number, number>, dt: number) {
  for (const node of nodes) {
    let glow = glowMap.get(node.id);
    if (!(glow > 0.005)) continue;
    glow = Math.max(0, glow - dt * 4);
    glowMap.set(node.id, glow);
    const style = STYLE[node.isServer ? 'server' : node.layer];
    node.mesh.material.emissiveIntensity = style.emI + glow * 6;
  }
}
