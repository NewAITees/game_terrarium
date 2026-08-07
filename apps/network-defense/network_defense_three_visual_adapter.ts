import {
  AdditiveBlending, BoxGeometry, Color, Group, Mesh, MeshBasicMaterial,
  OctahedronGeometry, SphereGeometry, TorusGeometry, Vector3,
} from 'three';
import { AGENT_RANKS } from './network_defense_config.js';
import type { NetworkDefenseVisualAdapter } from './network_defense_visual_adapter.js';

export function createNetworkDefenseThreeVisualAdapter(scene: any): NetworkDefenseVisualAdapter {
  return {
    createPacket(color, radius) {
      const mesh = new Mesh(new SphereGeometry(radius, 9, 9), new MeshBasicMaterial({ color }));
      scene.add(mesh);
      return mesh;
    },
    createAgent(rank, position) {
      const spec = AGENT_RANKS[rank];
      const mesh = new Mesh(new OctahedronGeometry(spec.size, 0), new MeshBasicMaterial({ color: spec.color }));
      mesh.position.copy(position);
      scene.add(mesh);
      return mesh;
    },
    move(handle, position) { handle.position.copy(position); },
    rotateAgent(handle, dt, working) {
      handle.rotation.y += dt * (working ? 7.2 : 2.4);
      handle.rotation.z += dt * (working ? 5.2 : 1.7);
    },
    destroyPacket(handle) {
      scene.remove(handle);
      handle.geometry.dispose();
      handle.material.dispose();
    },
    createFirewall(edge) {
      const center = edge.curve.getPoint(0.5);
      const ahead = edge.curve.getPoint(0.54);
      const tangent = ahead.clone().sub(center).normalize();
      const normal = new Vector3().crossVectors(tangent, new Vector3(0, 1, 0)).normalize();
      const wallMat = new MeshBasicMaterial({ color: 0x9cefff, transparent: true, opacity: 0.78, blending: AdditiveBlending, depthWrite: false });
      const glowMat = new MeshBasicMaterial({ color: 0xc9f8ff, transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false });
      const group = new Group();
      for (let index = -1; index <= 1; index += 1) {
        const slab = new Mesh(new BoxGeometry(0.24, 4.4, 2.6), wallMat.clone());
        slab.position.copy(center).addScaledVector(normal, index * 0.85);
        slab.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), tangent);
        group.add(slab);
      }
      const glow = new Mesh(new BoxGeometry(0.52, 5, 4), glowMat);
      glow.position.copy(center);
      glow.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), tangent);
      group.add(glow);
      const ring = new Mesh(new TorusGeometry(1.55, 0.09, 8, 22), new MeshBasicMaterial({ color: 0x77dfff, transparent: true, opacity: 0.45, blending: AdditiveBlending, depthWrite: false }));
      ring.position.copy(center);
      ring.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), tangent);
      group.add(ring);
      scene.add(group);
      return group;
    },
    updateFirewall(group, now) {
      const pulse = 0.72 + 0.28 * Math.sin(now * 6.8);
      group.scale.y = 0.96 + 0.08 * pulse;
      group.scale.z = 0.96 + 0.14 * pulse;
      group.children.forEach((child: any, index: number) => {
        if (child.material) child.material.opacity = index === group.children.length - 1 ? 0.18 + pulse * 0.16 : 0.36 + pulse * 0.42;
      });
    },
    destroyFirewall(group) {
      scene.remove(group);
      group.traverse((object: any) => {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) object.material.forEach((material: any) => material.dispose());
        else object.material?.dispose();
      });
    },
    updateNode(node, now) {
      const style = node.baseStyle;
      const color = new Color(style.color).lerp(new Color(0xff2e24), node.infection);
      if (node.hardenUntil > now) color.lerp(new Color(0x80e8ff), 0.55);
      if (node.rebootUntil > now) color.set(0x566472);
      node.material.color.copy(color);
      node.material.emissive.copy(color).multiplyScalar(node.isServer ? 0.55 : 0.35);
      node.material.emissiveIntensity = node.targetedUntil > now ? 2.2 : style.emI;
      if (node.halo?.material) {
        node.halo.material.color.copy(color);
        node.halo.material.opacity = node.hardenUntil > now ? 0.13 : style.hOp + node.infection * 0.13;
      }
    },
  };
}
