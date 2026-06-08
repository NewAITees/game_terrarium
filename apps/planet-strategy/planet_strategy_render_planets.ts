import * as THREE from 'three';

export function createPlanetStrategyPlanetVisuals(context: any) {
  const homePlanetIds = new Set();
  for (const empire of context.world.empires) {
    if (empire.homeFactoryId) homePlanetIds.add(empire.homeFactoryId);
    if (empire.homeMineId) homePlanetIds.add(empire.homeMineId);
  }
  addStarField(context.scene, context.rng);
  buildSceneObjects();
  function buildSceneObjects() {
    for (const planet of context.world.planets) {
      const isOwned = planet.owner >= 0;
      const empire = isOwned ? context.world.empires[planet.owner] : null;
      const baseColor = isOwned ? empire.color : '#3a4d5e';

      const mat = new THREE.MeshStandardMaterial({
        color: baseColor,
        emissive: new THREE.Color(baseColor).multiplyScalar(0.15),
        emissiveIntensity: 1,
        metalness: 0.28,
        roughness: 0.52,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 22), mat);
      mesh.position.set(planet.x, planet.y, planet.z);
      context.planetGroup.add(mesh);
      planet.mesh = mesh;
      planet.decorRings = [];

      const stockRing = new THREE.Mesh(
        new THREE.TorusGeometry(1.55, 0.07, 10, 36),
        new THREE.MeshBasicMaterial({ color: 0xb9e8ff, transparent: true, opacity: 0.22 })
      );
      stockRing.rotation.x = Math.PI / 2;
      stockRing.position.set(planet.x, planet.y, planet.z);
      context.planetGroup.add(stockRing);
      planet.ring = stockRing;

      const homeAura = new THREE.Mesh(
        new THREE.TorusGeometry(2.75, 0.11, 12, 48),
        new THREE.MeshBasicMaterial({ color: 0xdff8ff, transparent: true, opacity: 0.22 })
      );
      homeAura.rotation.x = Math.PI / 2;
      homeAura.position.set(planet.x, planet.y, planet.z);
      homeAura.visible = homePlanetIds.has(planet.id);
      context.planetGroup.add(homeAura);
      planet.homeAura = homeAura;

      const alertRing = new THREE.Mesh(
        new THREE.TorusGeometry(2.15, 0.12, 10, 40),
        new THREE.MeshBasicMaterial({ color: 0xffd37a, transparent: true, opacity: 0 })
      );
      alertRing.rotation.x = Math.PI / 2;
      alertRing.position.set(planet.x, planet.y, planet.z);
      alertRing.visible = false;
      context.planetGroup.add(alertRing);
      planet.alertRing = alertRing;

      const oreRing = new THREE.Mesh(
        new THREE.TorusGeometry(1.95, 0.055, 8, 32),
        new THREE.MeshBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 0.55 })
      );
      oreRing.rotation.x = Math.PI * 0.48;
      oreRing.position.set(planet.x, planet.y, planet.z);
      context.planetGroup.add(oreRing);
      planet.oreRing = oreRing;

      const labelSprite = createLabelSprite('');
      labelSprite.position.set(planet.x, planet.y + 11.5, planet.z);
      labelSprite.visible = false;
      context.planetGroup.add(labelSprite);
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
        context.planetGroup.add(ring);
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
        context.planetGroup.add(cluster);
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
          context.planetGroup.add(ring);
          planet.decorRings.push({ mesh: ring, axis: 'y', speed: i === 0 ? 0.75 : -0.48 });
        }
        const light = new THREE.PointLight(new THREE.Color(empire.color), 2.8, 160);
        light.position.set(planet.x, planet.y + 14, planet.z);
        context.scene.add(light);

        const beacon = new THREE.Mesh(
          new THREE.CylinderGeometry(0.14, 0.22, 7.5, 10),
          new THREE.MeshBasicMaterial({ color: 0xa8ecff, transparent: true, opacity: 0.28 })
        );
        beacon.position.set(planet.x, planet.y + 4.5, planet.z);
        context.planetGroup.add(beacon);
        planet.roleGlow = beacon;
      }
    }
  }
  function updatePlanetVisuals(contestedPlanets: Set<any>, dt: number): void {
    for (const planet of context.world.planets) {
      tickDecorRings(planet, dt);
    }
    for (const planet of context.world.planets) {
      const resFrac = planet.resources / Math.max(planet.maxResources, 1);
      const depleted = planet.resources <= 0;
      const contested = contestedPlanets.has(planet.id);
      const baseSize = 8.2;
      planet.mesh.scale.setScalar(baseSize);

      const baseColor = planet.owner >= 0 ? context.world.empires[planet.owner].color : '#5a6778';
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
  }
  return { updatePlanetVisuals };
}
function tickDecorRings(planet: any, dt: number) {
  for (const ring of planet.decorRings ?? []) {
    ring.mesh.rotation[ring.axis] += dt * ring.speed;
  }
}

function createLabelSprite(text: string) {
  const texture = new THREE.CanvasTexture(document.createElement('canvas'));
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(15, 4.2, 1);
  updateLabelSprite(sprite, text);
  return sprite;
}

function updateLabelSprite(sprite: any, text: string) {
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

function addStarField(scene: any, rng: () => number): void {
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

    const pick = rng();
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
