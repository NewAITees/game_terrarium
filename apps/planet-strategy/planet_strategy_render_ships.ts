import { BoxGeometry,BufferGeometry,Color,ConeGeometry,DoubleSide,EdgesGeometry,Group,Line,LineBasicMaterial,LineSegments,Mesh,MeshBasicMaterial,MeshStandardMaterial,PlaneGeometry,QuadraticBezierCurve3,SphereGeometry,Vector3, } from 'three';

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

  function getShipRouteState(ship: any) {
    const from = context.getPlanet(ship.fromPlanetId);
    const to = ship.status === 'attacking'
      ? context.getPlanet(ship.targetPlanetId)
      : context.getPlanet(ship.toPlanetId);
    if (!from || !to) return null;

    const isBack = ship.status === 'travel_back';
    const origin = isBack ? to : from;
    const target = isBack ? from : to;
    const progress = ship.status === 'loading'
      ? 0
      : ship.status === 'unloading'
        ? 1
        : ship.status === 'travel_back'
          ? 1 - ship.progress
          : ship.progress;
    const batchKey = `${origin.id}::${target.id}::${isBack ? 'back' : 'forward'}::${ship.kind}`;
    const route = context.world.routes.get(context.routeKey(origin.id, target.id))
      ?? context.world.routes.get(context.routeKey(from.id, to.id));

    return {
      batchKey,
      isAttacking: ship.status === 'attacking',
      origin,
      progress,
      route,
      ship,
      target,
    };
  }

  function buildRouteSideVector(direction: Vector3) {
    const side = new Vector3().crossVectors(direction, new Vector3(0, 1, 0));
    if (side.lengthSq() < 1e-6) {
      side.crossVectors(direction, new Vector3(1, 0, 0));
    }
    if (side.lengthSq() < 1e-6) {
      side.set(1, 0, 0);
    }
    return side.normalize();
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
    const p0 = new Vector3(from.x, from.y, from.z);
    const p2 = new Vector3(to.x, to.y, to.z);
    const mid = p0.clone().lerp(p2, 0.5);
    mid.y += 18 + context.distance3d(from, to) * 0.06;
    const curve = new QuadraticBezierCurve3(p0, mid, p2);
    const geometry = new BufferGeometry().setFromPoints(curve.getPoints(52));
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
    const movingShips = context.world.ships.filter((ship: any) => ship.mesh && ship.status !== 'orbiting' && ship.status !== 'battling');
    const routeBatches = new Map<string, any[]>();

    for (const ship of movingShips) {
      const state = getShipRouteState(ship);
      if (!state) continue;
      const list = routeBatches.get(state.batchKey) ?? [];
      list.push(state);
      routeBatches.set(state.batchKey, list);
    }

    for (const batch of routeBatches.values()) {
      batch.sort((a, b) => a.progress - b.progress || a.ship.id.localeCompare(b.ship.id));
      const spread = batch.length - 1;
      for (let index = 0; index < batch.length; index++) {
        const entry = batch[index];
        const laneOffset = (index - spread / 2) * 2.2;
        const envelope = 0.55 + Math.sin(Math.PI * entry.progress) * 0.45;
        const offset = laneOffset * envelope;
        const load = entry.ship.cargo / Math.max(entry.ship.capacity, 1);

        if (entry.route?.curve) {
          const ct = entry.progress;
          const pt = entry.route.curve.getPoint(ct);
          const tan = entry.route.curve.getTangent(ct).normalize();
          const side = buildRouteSideVector(tan);
          const lanePoint = pt.clone().addScaledVector(side, offset);
          entry.ship.mesh.position.set(lanePoint.x, lanePoint.y + 3 + entry.ship.owner * 2.2, lanePoint.z);
          entry.ship.mesh.rotation.y = Math.atan2(tan.x, tan.z);
        } else {
          const pos = lerpPlanet(entry.origin, entry.target, entry.progress);
          const direction = new Vector3(entry.target.x - entry.origin.x, (entry.target.y ?? 0) - (entry.origin.y ?? 0), entry.target.z - entry.origin.z).normalize();
          const side = buildRouteSideVector(direction);
          const lanePoint = new Vector3(pos.x, pos.y ?? 0, pos.z).addScaledVector(side, offset);
          entry.ship.mesh.position.set(lanePoint.x, lanePoint.y + 4 + entry.ship.owner * 2.2, lanePoint.z);
          entry.ship.mesh.rotation.y = Math.atan2(entry.target.x - entry.origin.x, entry.target.z - entry.origin.z);
        }

        setShipVisualState(entry.ship.mesh, entry.isAttacking ? 0.75 : 0.22 + load * 0.28);
        if (entry.ship.kind === 'transport') {
          setTransportLoadState(entry.ship.mesh, load);
        }
        entry.ship.mesh.scale.setScalar(1);
        updateTrail(entry.ship);
      }
    }
  }

  return {
    attachShipMesh,
    buildShipObjects,
    createShipFlash,
    ensureRouteVisual,
    removeShipMesh,
    updateRouteVisuals,
    updateShipVisuals,
  };
}

function createShipFlash(ship: any) {
  const mesh = new Mesh(
    new SphereGeometry(ship.kind === 'attacker' ? 1.4 : 1.1, 12, 12),
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

function createTrailLine(color: any) {
  const material = new LineBasicMaterial({
    color: new Color(color),
    transparent: true,
    opacity: 0.32,
  });
  const geometry = new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]);
  return new Line(geometry, material);
}

function updateTrail(ship: any) {
  if (!ship.trailLine || !ship.mesh) return;
  const point = ship.mesh.position.clone();
  ship.trailPoints.push(point);
  while (ship.trailPoints.length > 10) ship.trailPoints.shift();
  if (ship.trailPoints.length < 2) return;
  ship.trailLine.geometry.dispose();
  ship.trailLine.geometry = new BufferGeometry().setFromPoints(ship.trailPoints);
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
