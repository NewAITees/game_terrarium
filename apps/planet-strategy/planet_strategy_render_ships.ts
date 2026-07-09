import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  SphereGeometry,
  Vector3,
} from 'three';

export function createPlanetStrategyShipVisuals(context: any) {
  function makeShipMesh(empire: any, kind = 'transport') {
    const color = new Color(empire.color);
    const material = new MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.25,
      metalness: 0.45,
      roughness: 0.35,
    });

    if (kind === 'transport') {
      const hull = new Group();
      const body = new Mesh(new BoxGeometry(1.1, 0.68, 2.9), material);
      body.userData.shipPart = 'body';
      hull.add(body);

      const frameMaterial = new LineBasicMaterial({ color: 0xbfe2ff, transparent: true, opacity: 0.42 });
      const frame = new LineSegments(
        new EdgesGeometry(new BoxGeometry(1.16, 0.74, 2.96)),
        frameMaterial
      );
      frame.userData.shipPart = 'frame';
      hull.add(frame);
      return hull;
    }

    if (kind === 'attacker') {
      const geometry = new ConeGeometry(0.55, 4.2, 5);
      geometry.rotateX(Math.PI / 2);
      return new Mesh(geometry, material);
    }

    if (kind === 'gunship') {
      const hull = new Group();
      const core = new Mesh(new BoxGeometry(0.95, 0.72, 3.2), material);
      hull.add(core);
      const wings = new LineSegments(
        new EdgesGeometry(new BoxGeometry(1.8, 0.2, 2.6)),
        new LineBasicMaterial({ color: 0xf0fbff, transparent: true, opacity: 0.65 })
      );
      wings.position.y = 0.05;
      hull.add(wings);
      const nose = new Mesh(
        new ConeGeometry(0.32, 1.4, 4),
        new MeshBasicMaterial({ color: 0xe1f7ff, transparent: true, opacity: 0.8 })
      );
      nose.rotation.x = Math.PI / 2;
      nose.position.z = 2.0;
      hull.add(nose);
      return hull;
    }

    const hull = new Group();
    hull.add(new Mesh(new BoxGeometry(1.45, 1.45, 1.45), material));
    hull.add(new LineSegments(
      new EdgesGeometry(new BoxGeometry(1.52, 1.52, 1.52)),
      new LineBasicMaterial({ color: 0xe6f4ff, transparent: true, opacity: 0.9 })
    ));

    const faceGeo = new PlaneGeometry(0.46, 0.46);
    const faceMat = new MeshBasicMaterial({
      color: 0xc8f2ff,
      transparent: true,
      opacity: 0.5,
      side: DoubleSide,
    });
    const offsets = [
      [0, 0, 0.77, 0, 0, 0],
      [0, 0, -0.77, 0, Math.PI, 0],
      [0.77, 0, 0, 0, Math.PI / 2, 0],
      [-0.77, 0, 0, 0, -Math.PI / 2, 0],
      [0, 0.77, 0, -Math.PI / 2, 0, 0],
      [0, -0.77, 0, Math.PI / 2, 0, 0],
    ];
    for (const [x, y, z, rx, ry, rz] of offsets) {
      const panel = new Mesh(faceGeo, faceMat.clone());
      panel.position.set(x, y, z);
      panel.rotation.set(rx, ry, rz);
      hull.add(panel);
    }

    return hull;
  }

  function attachShipMesh(ship: any, empire: any): void {
    const mesh = makeShipMesh(empire, ship.kind);
    context.shipGroup.add(mesh);
    ship.mesh = mesh;
    ship.trailPoints = [];
    ship.trailLine = createTrailLine(empire.color, ship.kind === 'gunship' ? 0.45 : 0.32);
    context.shipGroup.add(ship.trailLine);
    syncShipMesh(ship);
  }

  function attachMissileMesh(missile: any): void {
    const mesh = new Mesh(
      new SphereGeometry(0.18, 8, 8),
      new MeshBasicMaterial({
        color: 0xfff2c4,
        transparent: true,
        opacity: 0.98,
        depthWrite: false,
      })
    );
    context.shipGroup.add(mesh);
    missile.mesh = mesh;
    missile.trailPoints = [];
    missile.trailLine = createTrailLine('#fff0c0', 0.22);
    context.shipGroup.add(missile.trailLine);
    mesh.position.set(missile.x, missile.y, missile.z);
  }

  function syncShipMesh(ship: any) {
    if (!ship.mesh || !ship.position) return;
    ship.mesh.position.set(ship.position.x, ship.position.y, ship.position.z);
  }

  function removeMissileMesh(missile: any): void {
    if (missile.trailLine) {
      context.shipGroup.remove(missile.trailLine);
      missile.trailLine.geometry?.dispose();
      missile.trailLine.material?.dispose();
      missile.trailLine = null;
    }
    if (missile.mesh) {
      context.shipGroup.remove(missile.mesh);
      missile.mesh.geometry?.dispose?.();
      missile.mesh.material?.dispose?.();
      missile.mesh = null;
    }
  }

  function removeShipMesh(ship: any): void {
    if (ship.trailLine) {
      context.shipGroup.remove(ship.trailLine);
      ship.trailLine.geometry?.dispose();
      ship.trailLine.material?.dispose();
      ship.trailLine = null;
    }
    if (!ship.mesh) return;
    context.shipGroup.remove(ship.mesh);
    ship.mesh.traverse((node: any) => {
      node.geometry?.dispose?.();
      if (Array.isArray(node.material)) {
        for (const material of node.material) material?.dispose?.();
      } else {
        node.material?.dispose?.();
      }
    });
    ship.mesh = null;
  }

  function ensureRouteVisual(route: any): void {
    if (route.line && route.curve) return;
    const from = context.getPlanet(route.fromPlanetId);
    const to = context.getPlanet(route.toPlanetId);
    if (!from || !to) return;
    const p0 = new Vector3(from.x, from.y, from.z);
    const p2 = new Vector3(to.x, to.y, to.z);
    const mid = p0.clone().lerp(p2, 0.5);
    mid.y += 18 + context.distance3d(from, to) * 0.06;
    const curve = new Vector3().copy(mid);
    const geometry = new BufferGeometry().setFromPoints([
      p0,
      mid,
      p2,
    ]);
    const material = new LineBasicMaterial({ color: 0x35627c, transparent: true, opacity: 0.15 });
    const line = new Line(geometry, material);
    const glow = new Line(
      geometry.clone(),
      new LineBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.08 })
    );
    context.routeGroup.add(line);
    context.routeGroup.add(glow);
    route.line = line;
    route.glow = glow;
    route.curve = {
      getPoint(t: number) {
        return new Vector3(
          from.x + (to.x - from.x) * t,
          from.y + (to.y - from.y) * t + Math.sin(Math.PI * t) * mid.y * 0.03,
          from.z + (to.z - from.z) * t
        );
      },
      getTangent(t: number) {
        return new Vector3(to.x - from.x, to.y - from.y, to.z - from.z).normalize();
      },
    };
  }

  function buildShipObjects() {
    for (const ship of context.world.ships) {
      attachShipMesh(ship, context.world.empires[ship.owner]);
    }
  }

  function updateRouteVisuals(): void {
    for (const route of context.world.routes.values()) {
      if (!route.line) continue;
      const hostile = (route.hostileTimer ?? 0) > 0;
      if (hostile) {
        const heat = Math.min((route.hostileTimer ?? 0) / 10, 1);
        route.line.material.opacity = 0.28 + heat * 0.42;
        route.line.material.color.set(0xff7a55);
        if (route.glow) {
          route.glow.material.opacity = 0.18 + heat * 0.3;
          route.glow.material.color.set(0xffc9a4);
        }
        continue;
      }
      const hot = Math.min(route.traffic / 14, 1);
      route.line.material.opacity = 0.06 + hot * 0.34;
      route.line.material.color.set(route.traffic > 10 ? 0x9fe6ff : route.traffic > 4 ? 0x5ca8c8 : 0x30556b);
      if (route.glow) {
        route.glow.material.opacity = 0.04 + hot * 0.28;
        route.glow.material.color.set(route.traffic > 10 ? 0xe7fbff : 0x82d6ff);
      }
    }
  }

  function updateShipVisuals(): void {
    for (const ship of context.world.ships) {
      if (!ship.mesh) continue;
      syncShipMesh(ship);
      if (ship.position) ship.mesh.position.set(ship.position.x, ship.position.y, ship.position.z);

      const direction = new Vector3();
      if (ship.status === 'traveling' || ship.status === 'approaching' || ship.status === 'launching') {
        const from = context.getPlanet(ship.fromPlanetId);
        const to = context.getPlanet(ship.toPlanetId);
        if (from && to) {
          direction.set(to.x - from.x, to.y - from.y, to.z - from.z).normalize();
          ship.mesh.rotation.y = Math.atan2(direction.x, direction.z);
        }
      } else if (ship.status === 'engaging') {
        ship.mesh.rotation.y += 0.02;
      }
      ship.mesh.scale.setScalar(ship.status === 'engaging' ? 1.08 : 1);
      updateTrail(ship);
    }
  }

  function updateMissileVisuals(): void {
    for (const missile of context.world.missiles) {
      if (!missile.mesh) continue;
      missile.mesh.position.set(missile.x, missile.y, missile.z);
      missile.mesh.scale.setScalar(0.95 + Math.sin(performance.now() / 90) * 0.12);
      updateMissileTrail(missile);
    }
  }

  function updateMissileTrail(missile: any) {
    if (!missile.trailLine || !missile.mesh) return;
    const point = missile.mesh.position.clone();
    missile.trailPoints.push(point);
    while (missile.trailPoints.length > 8) missile.trailPoints.shift();
    if (missile.trailPoints.length < 2) return;
    missile.trailLine.geometry.dispose();
    missile.trailLine.geometry = new BufferGeometry().setFromPoints(missile.trailPoints);
    missile.trailLine.material.opacity = 0.26;
  }

  return {
    attachMissileMesh,
    attachShipMesh,
    buildShipObjects,
    createShipDebris,
    createShipFlash,
    ensureRouteVisual,
    removeMissileMesh,
    removeShipMesh,
    updateMissileVisuals,
    updateRouteVisuals,
    updateShipVisuals,
  };
}

function createShipDebris(ship: any, color: any) {
  const count = ship.kind === 'attacker' || ship.kind === 'gunship' ? 18 : 12;
  const positions = new Float32Array(count * 3);
  const velocities: Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const speed = 7 + Math.random() * 16;
    velocities.push(new Vector3(
      Math.sin(phi) * Math.cos(theta) * speed,
      Math.cos(phi) * speed * 0.7,
      Math.sin(phi) * Math.sin(theta) * speed
    ));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    color: new Color(color).lerp(new Color(0xfff1d6), 0.45),
    size: 0.55,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const mesh = new Points(geometry, material);
  return {
    mesh,
    life: 0.62,
    maxLife: 0.62,
    update(progress: number, dt = 0) {
      const t = Math.max(0, Math.min(1, progress));
      const attribute = geometry.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < count; i++) {
        attribute.setXYZ(
          i,
          attribute.getX(i) + velocities[i].x * dt,
          attribute.getY(i) + velocities[i].y * dt,
          attribute.getZ(i) + velocities[i].z * dt
        );
      }
      attribute.needsUpdate = true;
      material.opacity = 0.95 * t * t;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

function createShipFlash(ship: any) {
  const mesh = new Mesh(
    new SphereGeometry(ship.kind === 'attacker' ? 1.4 : ship.kind === 'gunship' ? 1.25 : 1.1, 12, 12),
    new MeshBasicMaterial({
      color: ship.kind === 'defender' ? 0xffc8a0 : 0xfff0d8,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    })
  );
  return {
    mesh,
    life: 0.14,
    maxLife: 0.14,
    update(progress: number) {
      const t = Math.max(0, Math.min(1, progress));
      mesh.scale.setScalar(0.8 + (1 - t) * 1.9);
      mesh.material.opacity = 0.92 * t;
    },
    dispose() {
      mesh.geometry.dispose();
      mesh.material.dispose();
    },
  };
}

function createTrailLine(color: any, opacity: number) {
  const material = new LineBasicMaterial({
    color: new Color(color),
    transparent: true,
    opacity,
  });
  const geometry = new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]);
  return new Line(geometry, material);
}

function updateTrail(ship: any) {
  if (!ship.trailLine || !ship.mesh) return;
  const point = ship.mesh.position.clone();
  ship.trailPoints.push(point);
  while (ship.trailPoints.length > 12) ship.trailPoints.shift();
  if (ship.trailPoints.length < 2) return;
  ship.trailLine.geometry.dispose();
  ship.trailLine.geometry = new BufferGeometry().setFromPoints(ship.trailPoints);
  ship.trailLine.material.opacity = ship.status === 'engaging' ? 0.58 : 0.32;
}
