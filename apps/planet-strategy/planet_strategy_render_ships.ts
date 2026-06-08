import * as THREE from 'three';

export function createPlanetStrategyShipVisuals(context: any) {
  function makeShipMesh(empire: any, kind = 'transport') {
    const color = new THREE.Color(empire.color);
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.25,
      metalness: 0.45,
      roughness: 0.35,
    });

    if (kind === 'transport') {
      const hull = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.68, 2.9), material);
      body.userData.shipPart = 'body';
      hull.add(body);

      const frameMaterial = new THREE.LineBasicMaterial({ color: 0xbfe2ff, transparent: true, opacity: 0.42 });
      const frame = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1.16, 0.74, 2.96)),
        frameMaterial
      );
      frame.userData.shipPart = 'frame';
      hull.add(frame);
      return hull;
    }

    if (kind === 'attacker') {
      const geometry = new THREE.ConeGeometry(0.55, 4.2, 5);
      geometry.rotateX(Math.PI / 2);
      return new THREE.Mesh(geometry, material);
    }

    const hull = new THREE.Group();
    hull.add(new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.45, 1.45), material));
    hull.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.52, 1.52, 1.52)),
      new THREE.LineBasicMaterial({ color: 0xe6f4ff, transparent: true, opacity: 0.9 })
    ));

    const faceGeo = new THREE.PlaneGeometry(0.46, 0.46);
    const faceMat = new THREE.MeshBasicMaterial({
      color: 0xc8f2ff,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
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
      const panel = new THREE.Mesh(faceGeo, faceMat.clone());
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
    ship.trailLine = createTrailLine(empire.color);
    context.shipGroup.add(ship.trailLine);
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
    const p0 = new THREE.Vector3(from.x, from.y, from.z);
    const p2 = new THREE.Vector3(to.x, to.y, to.z);
    const mid = p0.clone().lerp(p2, 0.5);
    mid.y += 18 + context.distance3d(from, to) * 0.06;
    const curve = new THREE.QuadraticBezierCurve3(p0, mid, p2);
    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(52));
    const material = new THREE.LineBasicMaterial({ color: 0x35627c, transparent: true, opacity: 0.15 });
    const line = new THREE.Line(geometry, material);
    const glow = new THREE.Line(
      geometry.clone(),
      new THREE.LineBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.08 })
    );
    context.routeGroup.add(line);
    context.routeGroup.add(glow);
    route.line = line;
    route.glow = glow;
    route.curve = curve;
  }

  function buildShipObjects() {
    for (const ship of context.world.ships) {
      attachShipMesh(ship, context.world.empires[ship.owner]);
    }
  }

  function updateRouteVisuals(): void {
    for (const route of context.world.routes.values()) {
      if (!route.line) continue;
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
      if (ship.status === 'orbiting' || ship.status === 'battling') continue;

      const isAttacking = ship.status === 'attacking';
      const from = context.getPlanet(ship.fromPlanetId);
      const to = isAttacking ? context.getPlanet(ship.targetPlanetId) : context.getPlanet(ship.toPlanetId);
      if (!from || !to) continue;

      const origin = ship.status === 'travel_back' ? to : from;
      const target = ship.status === 'travel_back' ? from : to;
      const t = ship.progress;
      const load = ship.cargo / Math.max(ship.capacity, 1);
      const route = context.world.routes.get(context.routeKey(origin.id, target.id))
        ?? context.world.routes.get(context.routeKey(from.id, to.id));

      if (route?.curve) {
        const ct = ship.status === 'travel_back' ? 1 - t : t;
        const pt = route.curve.getPoint(ct);
        const tan = route.curve.getTangent(ct);
        ship.mesh.position.set(pt.x, pt.y + 3 + ship.owner * 2.2, pt.z);
        ship.mesh.rotation.y = Math.atan2(tan.x, tan.z);
      } else {
        const pos = lerpPlanet(origin, target, t);
        ship.mesh.position.set(pos.x, (pos.y ?? 0) + 4 + ship.owner * 2.2, pos.z);
        ship.mesh.rotation.y = Math.atan2(target.x - origin.x, target.z - origin.z);
      }

      setShipVisualState(ship.mesh, isAttacking ? 0.75 : 0.22 + load * 0.28);
      if (ship.kind === 'transport') {
        setTransportLoadState(ship.mesh, load);
      }
      ship.mesh.scale.setScalar(1);
      updateTrail(ship);
    }
  }

  return {
    attachShipMesh,
    buildShipObjects,
    ensureRouteVisual,
    removeShipMesh,
    updateRouteVisuals,
    updateShipVisuals,
  };
}

function createTrailLine(color: any) {
  const material = new THREE.LineBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0.32,
  });
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  return new THREE.Line(geometry, material);
}

function updateTrail(ship: any) {
  if (!ship.trailLine || !ship.mesh) return;
  const point = ship.mesh.position.clone();
  ship.trailPoints.push(point);
  while (ship.trailPoints.length > 10) ship.trailPoints.shift();
  if (ship.trailPoints.length < 2) return;
  ship.trailLine.geometry.dispose();
  ship.trailLine.geometry = new THREE.BufferGeometry().setFromPoints(ship.trailPoints);
  ship.trailLine.material.opacity = ship.status === 'attacking' ? 0.5 : 0.3;
}

function setShipVisualState(root: any, emissiveIntensity: number) {
  root.traverse((node: any) => {
    if (!node.material) return;
    if (Array.isArray(node.material)) {
      for (const material of node.material) {
        if ('emissiveIntensity' in material) material.emissiveIntensity = emissiveIntensity;
      }
      return;
    }
    if ('emissiveIntensity' in node.material) {
      node.material.emissiveIntensity = emissiveIntensity;
    }
  });
}

function setTransportLoadState(root: any, load: number) {
  root.traverse((node: any) => {
    if (node.userData.shipPart === 'frame' && node.material) {
      node.material.opacity = 0.18 + load * 0.62;
      node.material.color.set(load > 0.75 ? 0xffdf8a : load > 0.35 ? 0xd8f0ff : 0x8fb4c8);
    }
    if (node.userData.shipPart === 'body' && node.material && 'emissiveIntensity' in node.material) {
      node.material.emissiveIntensity = 0.18 + load * 0.42;
    }
  });
}

function lerpPlanet(a: any, b: any, t: number) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * t,
    z: a.z + (b.z - a.z) * t,
  };
}
