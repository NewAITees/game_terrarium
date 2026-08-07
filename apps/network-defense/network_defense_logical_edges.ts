import { edgeKey } from '../../shared/network-core.js';

type Point3 = { x: number; y: number; z: number };

function point(x: number, y: number, z: number) {
  return {
    x, y, z,
    distanceTo(other: Point3) {
      return Math.hypot(x - other.x, y - other.y, z - other.z);
    },
  };
}

function quadraticCurve(from: Point3, to: Point3, shortcut: boolean) {
  const control = point(
    (from.x + to.x) / 2,
    (from.y + to.y) / 2 + (shortcut ? 22 : 6),
    (from.z + to.z) / 2,
  );
  function getPoint(t: number) {
    const inverse = 1 - t;
    return point(
      inverse * inverse * from.x + 2 * inverse * t * control.x + t * t * to.x,
      inverse * inverse * from.y + 2 * inverse * t * control.y + t * t * to.y,
      inverse * inverse * from.z + 2 * inverse * t * control.z + t * t * to.z,
    );
  }
  return {
    getPoint,
    getPoints(segments: number) {
      return Array.from({ length: segments + 1 }, (_, index) => getPoint(index / segments));
    },
  };
}

export function buildNetworkDefenseLogicalEdges(topo: any) {
  const edgeMap = new Map<string, any>();
  const allEdges: any[] = [];
  const add = (a: any, b: any, shortcut: boolean) => {
    const edge = {
      an: a,
      bn: b,
      shortcut,
      activeUntil: 0,
      curve: quadraticCurve(a, b, shortcut),
    };
    allEdges.push(edge);
    edgeMap.set(edgeKey(a.id, b.id), edge);
  };
  topo.treeEdges.forEach((edge: any) => add(edge.a, edge.b, false));
  topo.shortcutEdges.forEach((edge: any) => add(edge.a, edge.b, true));
  return { edgeMap, allEdges };
}
