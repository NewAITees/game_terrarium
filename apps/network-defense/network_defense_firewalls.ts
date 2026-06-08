import { AdditiveBlending,BoxGeometry,Group,Mesh,MeshBasicMaterial,TorusGeometry,Vector3, } from 'three';

export function firewallKey(edge: any, edgeKey: (a: any, b: any) => string) {
  return edgeKey(edge.an.id, edge.bn.id);
}

export function deployFirewall(context: {
  edge: any;
  now: number;
  firewalls: Map<any, any>;
  scene: any;
  edgeKey: (a: any, b: any) => string;
}): void {
  const { edge, now, firewalls, scene, edgeKey } = context;
  if (!edge) return;
  const key = firewallKey(edge, edgeKey);
  const existing = firewalls.get(key);
  if (existing) {
    existing.until = Math.max(existing.until, now + 18);
    return;
  }

  const center = edge.curve.getPoint(0.5);
  const ahead = edge.curve.getPoint(0.54);
  const tangent = ahead.clone().sub(center).normalize();
  const up = new Vector3(0, 1, 0);
  const normal = new Vector3().crossVectors(tangent, up).normalize();
  const wallMat = new MeshBasicMaterial({
    color: 0x9cefff,
    transparent: true,
    opacity: 0.78,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const glowMat = new MeshBasicMaterial({
    color: 0xc9f8ff,
    transparent: true,
    opacity: 0.22,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const group = new Group();
  for (let i = -1; i <= 1; i++) {
    const slab = new Mesh(new BoxGeometry(0.24, 4.4, 2.6), wallMat.clone());
    slab.position.copy(center).addScaledVector(normal, i * 0.85);
    slab.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), tangent);
    group.add(slab);
  }
  const glow = new Mesh(new BoxGeometry(0.52, 5.0, 4.0), glowMat);
  glow.position.copy(center);
  glow.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), tangent);
  group.add(glow);
  const ring = new Mesh(
    new TorusGeometry(1.55, 0.09, 8, 22),
    new MeshBasicMaterial({
      color: 0x77dfff,
      transparent: true,
      opacity: 0.45,
      blending: AdditiveBlending,
      depthWrite: false,
    })
  );
  ring.position.copy(center);
  ring.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), tangent);
  group.add(ring);
  scene.add(group);
  firewalls.set(key, { edge, group, panels: group.children, until: now + 18 });
}

export function updateFirewalls(context: {
  firewalls: Map<any, any>;
  scene: any;
  now: number;
}): void {
  const { firewalls, scene, now } = context;
  for (const [key, firewall] of firewalls) {
    const pulse = 0.72 + 0.28 * Math.sin(now * 6.8);
    firewall.group.scale.y = 0.96 + 0.08 * pulse;
    firewall.group.scale.z = 0.96 + 0.14 * pulse;
    firewall.group.children.forEach((child: any, index: number) => {
      if (!child.material) return;
      child.material.opacity = index === firewall.group.children.length - 1
        ? 0.18 + pulse * 0.16
        : 0.36 + pulse * 0.42;
    });
    if (firewall.until <= now) {
      scene.remove(firewall.group);
      firewall.group.traverse((obj: any) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((mat: any) => mat.dispose());
          else obj.material.dispose();
        }
      });
      firewalls.delete(key);
    }
  }
}
