import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export function createPlanetStrategyRenderer({ world, rng, getPlanet, distance3d, routeKey }) {
  const homePlanetIds = new Set();
  for (const empire of world.empires) {
    if (empire.homeFactoryId) homePlanetIds.add(empire.homeFactoryId);
    if (empire.homeMineId) homePlanetIds.add(empire.homeMineId);
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06101c);
  scene.fog = new THREE.FogExp2(0x06101c, 0.0014);

  const camera = new THREE.PerspectiveCamera(44, innerWidth / innerHeight, 0.5, 1200);
  camera.position.set(0, 155, 250);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  document.body.appendChild(renderer.domElement);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 1.4, 0.45, 0.06));

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.045;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.15;
  controls.minDistance = 90;
  controls.maxDistance = 620;
  controls.target.set(0, 10, 0);

  scene.add(new THREE.AmbientLight(0x244060, 2.4));
  const keyLight = new THREE.DirectionalLight(0xfff0d0, 1.7);
  keyLight.position.set(80, 120, 60);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x3355aa, 0.85);
  fillLight.position.set(-90, 60, -80);
  scene.add(fillLight);
  scene.add(new THREE.GridHelper(520, 24, 0x112034, 0x0b1626));

  const planetGroup = new THREE.Group();
  const routeGroup = new THREE.Group();
  const shipGroup = new THREE.Group();
  scene.add(planetGroup);
  scene.add(routeGroup);
  scene.add(shipGroup);

  addStarField(scene, rng);
  buildSceneObjects();

  function makeShipMesh(empire, kind = 'transport') {
    const c = new THREE.Color(empire.color);
    const mat = new THREE.MeshStandardMaterial({
      color: c,
      emissive: c,
      emissiveIntensity: 0.25,
      metalness: 0.45,
      roughness: 0.35,
    });

    if (kind === 'transport') {
      const hull = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.68, 2.9), mat);
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

    let geo;
    if (kind === 'attacker') {
      geo = new THREE.ConeGeometry(0.55, 4.2, 5);
      geo.rotateX(Math.PI / 2);
    } else if (kind === 'defender') {
      const hull = new THREE.Group();

      const body = new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.45, 1.45), mat);
      hull.add(body);

      const frame = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1.52, 1.52, 1.52)),
        new THREE.LineBasicMaterial({ color: 0xe6f4ff, transparent: true, opacity: 0.9 })
      );
      hull.add(frame);

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
    return new THREE.Mesh(geo, mat);
  }

  function attachShipMesh(ship, empire) {
    const mesh = makeShipMesh(empire, ship.kind);
    shipGroup.add(mesh);
    ship.mesh = mesh;
    ship.trailPoints = [];
    ship.trailLine = createTrailLine(empire.color);
    shipGroup.add(ship.trailLine);
  }

  function removeShipMesh(ship) {
    if (ship.trailLine) {
      shipGroup.remove(ship.trailLine);
      ship.trailLine.geometry?.dispose();
      ship.trailLine.material?.dispose();
      ship.trailLine = null;
    }
    if (!ship.mesh) return;
    shipGroup.remove(ship.mesh);
    ship.mesh.traverse((node) => {
      node.geometry?.dispose?.();
      if (Array.isArray(node.material)) {
        for (const material of node.material) material?.dispose?.();
      } else {
        node.material?.dispose?.();
      }
    });
    ship.mesh = null;
  }

  function ensureRouteVisual(route) {
    if (route.line && route.curve) return;
    const from = getPlanet(route.fromPlanetId);
    const to = getPlanet(route.toPlanetId);
    if (!from || !to) return;
    const p0 = new THREE.Vector3(from.x, from.y, from.z);
    const p2 = new THREE.Vector3(to.x, to.y, to.z);
    const mid = p0.clone().lerp(p2, 0.5);
    mid.y += 18 + distance3d(from, to) * 0.06;
    const curve = new THREE.QuadraticBezierCurve3(p0, mid, p2);
    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(52));
    const material = new THREE.LineBasicMaterial({ color: 0x35627c, transparent: true, opacity: 0.15 });
    const line = new THREE.Line(geometry, material);
    const glow = new THREE.Line(
      geometry.clone(),
      new THREE.LineBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.08 })
    );
    routeGroup.add(line);
    routeGroup.add(glow);
    route.line = line;
    route.glow = glow;
    route.curve = curve;
  }

  function updateVisuals(dt = 0) {
    tickDecorRings(dt);
    const contestedPlanets = new Set(
      world.ships
        .filter((ship) => ship.status === 'battling' || ship.status === 'attacking')
        .map((ship) => ship.targetPlanetId)
        .filter(Boolean)
    );

    for (const planet of world.planets) {
      const resFrac = planet.resources / Math.max(planet.maxResources, 1);
      const depleted = planet.resources <= 0;
      const contested = contestedPlanets.has(planet.id);
      const baseSize = 8.2;
      planet.mesh.scale.setScalar(baseSize);

      const baseColor = planet.owner >= 0 ? world.empires[planet.owner].color : '#5a6778';
      const showColor = depleted ? '#1a111f' : contested ? '#ffd6a0' : baseColor;
      planet.mesh.material.color.set(showColor);
      planet.mesh.material.emissive.set(depleted ? '#0e0812' : showColor)
        .multiplyScalar(depleted ? 0.32 : contested ? 0.35 : planet.owner >= 0 ? 0.08 + resFrac * 0.35 : 0.04 + resFrac * 0.12);

      const stallPulse = planet.stalled ? 1 + Math.sin(performance.now() / 220) * 0.08 : 1;
      const ringScale = 1.8 + Math.min(planet.stock / 90, 1.8);
      planet.ring.scale.setScalar(ringScale * baseSize * 0.22 * stallPulse);
      planet.ring.material.opacity = depleted ? 0.04 : 0.12 + Math.min(planet.stock / 180, contested ? 0.48 : 0.35);
      planet.ring.material.color.set(planet.stalled ? 0xff6f59 : contested ? 0xfff4b0 : planet.stock > 15 ? 0xa8ecff : 0x66798d);

      if (planet.oreRing) {
        planet.oreRing.scale.setScalar(baseSize * 0.3 + resFrac * baseSize * 0.1);
        planet.oreRing.material.opacity = depleted ? 0 : 0.15 + resFrac * 0.5;
      }

      if (planet.alertRing) {
        const alertPulse = 1 + Math.sin(performance.now() / 140) * 0.12;
        planet.alertRing.visible = contested;
        planet.alertRing.scale.setScalar(baseSize * 0.28 * alertPulse);
        planet.alertRing.material.opacity = contested ? 0.3 + Math.sin(performance.now() / 100) * 0.12 : 0;
      }

      if (planet.homeAura) {
        const homePulse = 1 + Math.sin(performance.now() / 420) * 0.05;
        planet.homeAura.visible = homePlanetIds.has(planet.id);
        planet.homeAura.scale.setScalar(homePulse);
        planet.homeAura.material.opacity = planet.homeAura.visible ? 0.16 + (contested ? 0.08 : 0) : 0;
      }

      if (planet.roleGlow) {
        if (planet.type === 'mine') {
          planet.roleGlow.rotation.y += dt * 0.2;
          for (const child of planet.roleGlow.children) {
            child.material.opacity = depleted ? 0.05 : 0.42 + resFrac * 0.28;
          }
        } else if (planet.type === 'factory') {
          planet.roleGlow.material.opacity = planet.stalled ? 0.16 : 0.26;
          planet.roleGlow.position.y = planet.y + 4.5 + Math.sin(performance.now() / 320) * 0.35;
        }
      }

      if (planet.labelSprite) {
        let label = '';
        if (planet.stalled) label = 'STALLED';
        else if (contested) label = 'CONTESTED';
        else if (depleted) label = 'DEPLETED';
        else if (homePlanetIds.has(planet.id)) label = 'HOME';
        planet.labelSprite.position.y = planet.y + (homePlanetIds.has(planet.id) ? 13 : 11.5);
        planet.labelSprite.visible = label.length > 0;
        if (label && planet.labelText !== label) {
          updateLabelSprite(planet.labelSprite, label);
          planet.labelText = label;
        }
      }
    }

    for (const route of world.routes.values()) {
      if (!route.line) continue;
      const hot = Math.min(route.traffic / 14, 1);
      route.line.material.opacity = 0.06 + hot * 0.34;
      route.line.material.color.set(route.traffic > 10 ? 0x9fe6ff : route.traffic > 4 ? 0x5ca8c8 : 0x30556b);
      if (route.glow) {
        route.glow.material.opacity = 0.04 + hot * 0.28;
        route.glow.material.color.set(route.traffic > 10 ? 0xe7fbff : 0x82d6ff);
      }
    }

    for (const ship of world.ships) {
      if (!ship.mesh) continue;
      if (ship.status === 'orbiting' || ship.status === 'battling') continue;

      const isAttacking = ship.status === 'attacking';
      const from = getPlanet(ship.fromPlanetId);
      const to = isAttacking ? getPlanet(ship.targetPlanetId) : getPlanet(ship.toPlanetId);
      if (!from || !to) continue;

      const origin = ship.status === 'travel_back' ? to : from;
      const target = ship.status === 'travel_back' ? from : to;
      const t = ship.progress;
      const load = ship.cargo / Math.max(ship.capacity, 1);
      const route = world.routes.get(routeKey(origin.id, target.id))
        ?? world.routes.get(routeKey(from.id, to.id));

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

  function renderFrame() {
    controls.update();
    composer.render();
  }

  function onResize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  }

  function buildSceneObjects() {
    for (const planet of world.planets) {
      const isOwned = planet.owner >= 0;
      const empire = isOwned ? world.empires[planet.owner] : null;
      const baseCol = isOwned ? empire.color : '#3a4d5e';

      const mat = new THREE.MeshStandardMaterial({
        color: baseCol,
        emissive: new THREE.Color(baseCol).multiplyScalar(0.15),
        emissiveIntensity: 1,
        metalness: 0.28,
        roughness: 0.52,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 22), mat);
      mesh.position.set(planet.x, planet.y, planet.z);
      planetGroup.add(mesh);
      planet.mesh = mesh;
      planet.decorRings = [];

      const stockRing = new THREE.Mesh(
        new THREE.TorusGeometry(1.55, 0.07, 10, 36),
        new THREE.MeshBasicMaterial({ color: 0xb9e8ff, transparent: true, opacity: 0.22 })
      );
      stockRing.rotation.x = Math.PI / 2;
      stockRing.position.set(planet.x, planet.y, planet.z);
      planetGroup.add(stockRing);
      planet.ring = stockRing;

      const homeAura = new THREE.Mesh(
        new THREE.TorusGeometry(2.75, 0.11, 12, 48),
        new THREE.MeshBasicMaterial({ color: 0xdff8ff, transparent: true, opacity: 0.22 })
      );
      homeAura.rotation.x = Math.PI / 2;
      homeAura.position.set(planet.x, planet.y, planet.z);
      homeAura.visible = homePlanetIds.has(planet.id);
      planetGroup.add(homeAura);
      planet.homeAura = homeAura;

      const alertRing = new THREE.Mesh(
        new THREE.TorusGeometry(2.15, 0.12, 10, 40),
        new THREE.MeshBasicMaterial({ color: 0xffd37a, transparent: true, opacity: 0 })
      );
      alertRing.rotation.x = Math.PI / 2;
      alertRing.position.set(planet.x, planet.y, planet.z);
      alertRing.visible = false;
      planetGroup.add(alertRing);
      planet.alertRing = alertRing;

      const oreRing = new THREE.Mesh(
        new THREE.TorusGeometry(1.95, 0.055, 8, 32),
        new THREE.MeshBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 0.55 })
      );
      oreRing.rotation.x = Math.PI * 0.48;
      oreRing.position.set(planet.x, planet.y, planet.z);
      planetGroup.add(oreRing);
      planet.oreRing = oreRing;

      const labelSprite = createLabelSprite('');
      labelSprite.position.set(planet.x, planet.y + 11.5, planet.z);
      labelSprite.visible = false;
      planetGroup.add(labelSprite);
      planet.labelSprite = labelSprite;
      planet.labelText = '';

      if (!isOwned) continue;

      if (planet.type === 'mine') {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(2.2, 0.06, 8, 32),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(empire.color), transparent: true, opacity: 0.6 })
        );
        ring.position.set(planet.x, planet.y, planet.z);
        ring.rotation.x = Math.PI * 0.32;
        planetGroup.add(ring);
        planet.decorRings.push({ mesh: ring, axis: 'y', speed: 0.55 });

        const cluster = new THREE.Group();
        for (let i = 0; i < 3; i++) {
          const shard = new THREE.Mesh(
            new THREE.TetrahedronGeometry(0.34 + i * 0.05, 0),
            new THREE.MeshBasicMaterial({ color: 0xffcf68, transparent: true, opacity: 0.78 })
          );
          const angle = (i / 3) * Math.PI * 2;
          shard.position.set(Math.cos(angle) * 2.55, 0.25 + i * 0.1, Math.sin(angle) * 2.55);
          cluster.add(shard);
        }
        cluster.position.set(planet.x, planet.y, planet.z);
        planetGroup.add(cluster);
        planet.roleGlow = cluster;
      }

      if (planet.type === 'factory') {
        for (let i = 0; i < 2; i++) {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(2.3 + i * 1.0, 0.07, 8, 34),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(empire.color), transparent: true, opacity: 0.55 })
          );
          ring.position.set(planet.x, planet.y, planet.z);
          ring.rotation.x = Math.PI / 2 + i * 0.25;
          planetGroup.add(ring);
          planet.decorRings.push({ mesh: ring, axis: 'y', speed: i === 0 ? 0.75 : -0.48 });
        }
        const light = new THREE.PointLight(new THREE.Color(empire.color), 2.8, 160);
        light.position.set(planet.x, planet.y + 14, planet.z);
        scene.add(light);

        const beacon = new THREE.Mesh(
          new THREE.CylinderGeometry(0.14, 0.22, 7.5, 10),
          new THREE.MeshBasicMaterial({ color: 0xa8ecff, transparent: true, opacity: 0.28 })
        );
        beacon.position.set(planet.x, planet.y + 4.5, planet.z);
        planetGroup.add(beacon);
        planet.roleGlow = beacon;
      }
    }

    for (const ship of world.ships) {
      attachShipMesh(ship, world.empires[ship.owner]);
    }
  }

  function tickDecorRings(dt) {
    for (const planet of world.planets) {
      for (const ring of planet.decorRings ?? []) {
        ring.mesh.rotation[ring.axis] += dt * ring.speed;
      }
    }
  }

  function createTrailLine(color) {
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.32,
    });
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    return new THREE.Line(geometry, material);
  }

  function updateTrail(ship) {
    if (!ship.trailLine || !ship.mesh) return;
    const point = ship.mesh.position.clone();
    ship.trailPoints.push(point);
    while (ship.trailPoints.length > 10) ship.trailPoints.shift();
    if (ship.trailPoints.length < 2) return;
    ship.trailLine.geometry.dispose();
    ship.trailLine.geometry = new THREE.BufferGeometry().setFromPoints(ship.trailPoints);
    ship.trailLine.material.opacity = ship.status === 'attacking' ? 0.5 : 0.3;
  }

  function setShipVisualState(root, emissiveIntensity) {
    root.traverse((node) => {
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

  function setTransportLoadState(root, load) {
    root.traverse((node) => {
      if (node.userData.shipPart === 'frame' && node.material) {
        node.material.opacity = 0.18 + load * 0.62;
        node.material.color.set(load > 0.75 ? 0xffdf8a : load > 0.35 ? 0xd8f0ff : 0x8fb4c8);
      }
      if (node.userData.shipPart === 'body' && node.material && 'emissiveIntensity' in node.material) {
        node.material.emissiveIntensity = 0.18 + load * 0.42;
      }
    });
  }

  function createLabelSprite(text) {
    const texture = new THREE.CanvasTexture(document.createElement('canvas'));
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(15, 4.2, 1);
    updateLabelSprite(sprite, text);
    return sprite;
  }

  function updateLabelSprite(sprite, text) {
    const canvas = sprite.material.map.image;
    const ctx = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 72;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(7, 14, 24, 0.72)';
    ctx.fillRect(8, 10, 240, 52);
    ctx.strokeStyle = 'rgba(166, 224, 255, 0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 10, 240, 52);
    ctx.fillStyle = '#e8f8ff';
    ctx.font = 'bold 26px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 37);
    sprite.material.map.needsUpdate = true;
  }

  return {
    attachShipMesh,
    ensureRouteVisual,
    removeShipMesh,
    renderFrame,
    updateVisuals,
    onResize,
  };
}

function addStarField(scene, rng) {
  const count = 2600;
  const pos = new Float32Array(count * 3);
  const cols = new Float32Array(count * 3);
  const innerVoid = 180;
  const starColors = [
    [0.75, 0.85, 1.0],
    [0.95, 0.95, 1.0],
    [1.0, 1.0, 0.9],
    [1.0, 0.88, 0.7],
    [1.0, 0.72, 0.55],
  ];
  const weights = [0.05, 0.15, 0.35, 0.3, 0.15];

  for (let i = 0; i < count; i++) {
    const branch = rng();
    let x;
    let y;
    let z;
    if (branch < 0.78) {
      const angle = rng() * Math.PI * 2;
      const radius = innerVoid + Math.pow(rng(), 0.52) * 760;
      x = Math.cos(angle) * radius;
      z = Math.sin(angle) * radius;
      y = (rng() - 0.5) * (22 + radius * 0.035);
    } else {
      const theta = rng() * Math.PI * 2;
      const phi = Math.acos(2 * rng() - 1);
      const radius = 520 + rng() * 640;
      x = radius * Math.sin(phi) * Math.cos(theta);
      y = radius * Math.cos(phi) * 0.42;
      z = radius * Math.sin(phi) * Math.sin(theta);
    }

    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;

    let pick = rng();
    let cumulative = 0;
    let colorIdx = 0;
    for (let c = 0; c < weights.length; c++) {
      cumulative += weights[c];
      if (pick < cumulative) {
        colorIdx = c;
        break;
      }
    }
    const [cr, cg, cb] = starColors[colorIdx];
    const bright = 0.55 + rng() * 0.45;
    cols[i * 3] = cr * bright;
    cols[i * 3 + 1] = cg * bright;
    cols[i * 3 + 2] = cb * bright;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  scene.add(new THREE.Points(
    geo,
    new THREE.PointsMaterial({ vertexColors: true, size: 1.2, transparent: true, opacity: 0.58, sizeAttenuation: true })
  ));
}

function lerpPlanet(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

