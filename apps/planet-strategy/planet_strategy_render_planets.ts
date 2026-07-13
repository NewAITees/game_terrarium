import { BufferAttribute,BufferGeometry,CanvasTexture,Color,ConeGeometry,CylinderGeometry,Group,LinearFilter,Mesh,MeshBasicMaterial,MeshStandardMaterial,PointLight,Points,PointsMaterial,SphereGeometry,Sprite,SpriteMaterial,TetrahedronGeometry,TorusGeometry, } from 'three';
import { loadStructureAsset, normalizeAssetInstance } from './planet_strategy_render_assets.js';

export function createPlanetStrategyPlanetVisuals(context: any) {
  const homePlanetIds = new Set();
  for (const empire of context.world.empires) {
    if (empire.homeFactoryId) homePlanetIds.add(empire.homeFactoryId);
    if (empire.homeMineId) homePlanetIds.add(empire.homeMineId);
  }
  addStarField(context.scene, context.rng);
  buildSceneObjects();
  void hydrateStructureAssets();
  function buildSceneObjects() {
    for (const planet of context.world.planets) {
      const isOwned = planet.owner >= 0;
      const empire = isOwned ? context.world.empires[planet.owner] : null;
      const baseColor = isOwned ? empire.color : '#3a4d5e';

      const mat = new MeshStandardMaterial({
        color: baseColor,
        emissive: new Color(baseColor).multiplyScalar(0.15),
        emissiveIntensity: 1,
        metalness: 0.28,
        roughness: 0.52,
      });
      const mesh = new Mesh(new SphereGeometry(1, 22, 22), mat);
      mesh.position.set(planet.x, planet.y, planet.z);
      context.planetGroup.add(mesh);
      planet.mesh = mesh;
      planet.decorRings = [];

      const stockRing = new Mesh(
        new TorusGeometry(1.55, 0.07, 10, 36),
        new MeshBasicMaterial({ color: 0xb9e8ff, transparent: true, opacity: 0.22 })
      );
      stockRing.rotation.x = Math.PI / 2;
      stockRing.position.set(planet.x, planet.y, planet.z);
      context.planetGroup.add(stockRing);
      planet.ring = stockRing;

      const homeAura = new Mesh(
        new TorusGeometry(2.75, 0.11, 12, 48),
        new MeshBasicMaterial({ color: 0xdff8ff, transparent: true, opacity: 0.22 })
      );
      homeAura.rotation.x = Math.PI / 2;
      homeAura.position.set(planet.x, planet.y, planet.z);
      homeAura.visible = homePlanetIds.has(planet.id);
      context.planetGroup.add(homeAura);
      planet.homeAura = homeAura;

      const alertRing = new Mesh(
        new TorusGeometry(2.15, 0.12, 10, 40),
        new MeshBasicMaterial({ color: 0xffd37a, transparent: true, opacity: 0 })
      );
      alertRing.rotation.x = Math.PI / 2;
      alertRing.position.set(planet.x, planet.y, planet.z);
      alertRing.visible = false;
      context.planetGroup.add(alertRing);
      planet.alertRing = alertRing;

      const oreRing = new Mesh(
        new TorusGeometry(1.95, 0.055, 8, 32),
        new MeshBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 0.55 })
      );
      oreRing.rotation.x = Math.PI * 0.48;
      oreRing.position.set(planet.x, planet.y, planet.z);
      context.planetGroup.add(oreRing);
      planet.oreRing = oreRing;

      const ownershipRing = new Mesh(
        new TorusGeometry(1.72, 0.03, 8, 36),
        new MeshBasicMaterial({ color: new Color(baseColor), transparent: true, opacity: isOwned ? 0.8 : 0.18 })
      );
      ownershipRing.rotation.x = Math.PI / 2;
      ownershipRing.position.set(planet.x, planet.y, planet.z);
      ownershipRing.visible = isOwned;
      context.planetGroup.add(ownershipRing);
      planet.ownershipRing = ownershipRing;

      const labelSprite = createLabelSprite('');
      labelSprite.position.set(planet.x, planet.y + 11.5, planet.z);
      labelSprite.visible = false;
      context.planetGroup.add(labelSprite);
      planet.labelSprite = labelSprite;
      planet.labelText = '';

      if (!isOwned) continue;

      if (planet.type === 'mine') {
        const ring = new Mesh(
          new TorusGeometry(2.2, 0.06, 8, 32),
          new MeshBasicMaterial({ color: new Color(empire.color), transparent: true, opacity: 0.6 })
        );
        ring.position.set(planet.x, planet.y, planet.z);
        ring.rotation.x = Math.PI * 0.32;
        context.planetGroup.add(ring);
        planet.decorRings.push({ mesh: ring, axis: 'y', speed: 0.55 });

        const cluster = new Group();
        for (let i = 0; i < 3; i++) {
          const shard = new Mesh(
            new TetrahedronGeometry(0.34 + i * 0.05, 0),
            new MeshBasicMaterial({ color: 0xffcf68, transparent: true, opacity: 0.78 })
          );
          const angle = (i / 3) * Math.PI * 2;
          shard.position.set(Math.cos(angle) * 2.55, 0.25 + i * 0.1, Math.sin(angle) * 2.55);
          cluster.add(shard);
        }
        cluster.position.set(planet.x, planet.y, planet.z);
        context.planetGroup.add(cluster);
        planet.roleGlow = cluster;

        const assetAnchor = new Group();
        assetAnchor.position.set(planet.x, planet.y + 1.2, planet.z);
        assetAnchor.userData.assetMode = 'surface';
        context.planetGroup.add(assetAnchor);
        planet.structureAsset = assetAnchor;
      }

      if (planet.type === 'factory') {
        for (let i = 0; i < 2; i++) {
          const ring = new Mesh(
            new TorusGeometry(2.3 + i * 1.0, 0.07, 8, 34),
            new MeshBasicMaterial({ color: new Color(empire.color), transparent: true, opacity: 0.55 })
          );
          ring.position.set(planet.x, planet.y, planet.z);
          ring.rotation.x = Math.PI / 2 + i * 0.25;
          context.planetGroup.add(ring);
          planet.decorRings.push({ mesh: ring, axis: 'y', speed: i === 0 ? 0.75 : -0.48 });
        }
        const light = new PointLight(new Color(empire.color), 2.8, 160);
        light.position.set(planet.x, planet.y + 14, planet.z);
        context.scene.add(light);
        planet.factoryLight = light;

        const beacon = new Mesh(
          new CylinderGeometry(0.14, 0.22, 7.5, 10),
          new MeshBasicMaterial({ color: 0xa8ecff, transparent: true, opacity: 0.28 })
        );
        beacon.position.set(planet.x, planet.y + 4.5, planet.z);
        context.planetGroup.add(beacon);
        planet.roleGlow = beacon;

        const assetAnchor = new Group();
        assetAnchor.position.set(planet.x, planet.y, planet.z);
        assetAnchor.userData.assetMode = 'orbit';
        assetAnchor.userData.orbitRadius = 7.6;
        assetAnchor.userData.orbitAngle = context.rng() * Math.PI * 2;
        assetAnchor.userData.orbitSpeed = 0.12;
        context.planetGroup.add(assetAnchor);
        planet.structureAsset = assetAnchor;

        const turretAnchor = new Group();
        turretAnchor.position.set(planet.x, planet.y, planet.z);
        turretAnchor.userData.assetMode = 'orbit';
        turretAnchor.userData.orbitRadius = 10.1;
        turretAnchor.userData.orbitAngle = context.rng() * Math.PI * 2;
        turretAnchor.userData.orbitSpeed = 0.18;
        context.planetGroup.add(turretAnchor);
        planet.turretAsset = turretAnchor;

        const lightGroup = new Group();
        lightGroup.position.set(planet.x, planet.y, planet.z);
        context.planetGroup.add(lightGroup);
        for (let i = 0; i < 4; i++) {
          const dockLight = new Mesh(
            new SphereGeometry(0.12, 8, 8),
            new MeshBasicMaterial({ color: new Color(empire.color), transparent: true, opacity: 0.75 })
          );
          dockLight.userData.phase = (i / 4) * Math.PI * 2;
          lightGroup.add(dockLight);
        }
        planet.factoryLightGroup = lightGroup;
      }

      const factoryIcon = new Mesh(
        new ConeGeometry(0.42, 1.3, 5),
        new MeshBasicMaterial({ color: isOwned ? new Color(baseColor) : 0xbcc8d6, transparent: true, opacity: 0.9 })
      );
      factoryIcon.rotation.x = Math.PI;
      factoryIcon.position.set(planet.x, planet.y + 9.2, planet.z);
      factoryIcon.visible = false;
      context.planetGroup.add(factoryIcon);
      planet.factoryIcon = factoryIcon;
    }
  }
  async function hydrateStructureAssets(): Promise<void> {
    const [factoryAsset, stationAsset, mineAsset, turretAsset] = await Promise.all([
      loadStructureAsset('assets/structures/factory.glb'),
      loadStructureAsset('assets/structures/station.glb'),
      loadStructureAsset('assets/structures/mine_dish.glb'),
      loadStructureAsset('assets/structures/turret.glb'),
    ]);
    for (const planet of context.world.planets) {
      if (!planet.structureAsset) continue;
      const source = planet.type === 'factory'
        ? (stationAsset ?? factoryAsset)
        : planet.type === 'mine'
          ? mineAsset
          : null;
      if (!source) continue;
      const model = normalizeAssetInstance(source, planet.type === 'factory' ? 4.8 : 3.8);
      model.rotation.x = -Math.PI / 2;
      if (planet.type === 'factory') {
        model.rotation.z = Math.PI * 0.1;
        model.position.set(planet.structureAsset.userData.orbitRadius ?? 7.6, 1.8, 0);
      }
      if (planet.type === 'mine') model.rotation.z = Math.PI * 0.1;
      planet.structureAsset.add(model);
      tintAsset(model, planet.owner >= 0 ? context.world.empires[planet.owner].color : '#9fb0bf');

      if (planet.turretAsset && planet.structures.turret > 0 && turretAsset) {
        const turret = normalizeAssetInstance(turretAsset, 2.1);
        turret.rotation.x = -Math.PI / 2;
        turret.position.set(0, 0.4, 0);
        planet.turretAsset.add(turret);
        tintAsset(turret, planet.owner >= 0 ? context.world.empires[planet.owner].color : '#9fb0bf');
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
      const baseSize = depleted ? 1.5 : 8.2;
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
        planet.oreRing.visible = !depleted;
        planet.oreRing.material.opacity = depleted ? 0 : 0.15 + resFrac * 0.5;
      }

      if (planet.ownershipRing) {
        planet.ownershipRing.visible = planet.owner >= 0;
        planet.ownershipRing.scale.setScalar(depleted ? 0.95 : 1.02);
        planet.ownershipRing.material.color.set(baseColor);
        planet.ownershipRing.material.opacity = depleted ? 0.95 : 0.22 + (contested ? 0.2 : 0);
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

      if (planet.structureAsset) {
        const collapsing = (planet.collapseTimer ?? 0) > 0;
        if (collapsing) planet.collapseTimer = Math.max(0, planet.collapseTimer - dt);
        planet.structureAsset.visible = collapsing || planet.structures.mine > 0 || planet.structures.factory > 0;
        if (planet.structureAsset.userData.assetMode === 'orbit') {
          const orbitRadius = planet.structureAsset.userData.orbitRadius ?? 7.6;
          planet.structureAsset.userData.orbitAngle += dt * (planet.structureAsset.userData.orbitSpeed ?? 0.12);
          planet.structureAsset.position.set(
            planet.x + Math.cos(planet.structureAsset.userData.orbitAngle) * orbitRadius,
            planet.y + 1.2,
            planet.z + Math.sin(planet.structureAsset.userData.orbitAngle) * orbitRadius
          );
          planet.structureAsset.rotation.y = planet.structureAsset.userData.orbitAngle;
        } else {
          planet.structureAsset.position.set(planet.x, planet.y + 1.2, planet.z);
          planet.structureAsset.rotation.y += dt * 0.12;
        }
        planet.structureAsset.scale.setScalar(
          collapsing ? Math.max(0.04, planet.collapseTimer / 0.7) : depleted ? 0.82 : 1
        );
        tintAsset(planet.structureAsset, collapsing ? '#ff5a3c' : baseColor, collapsing ? 0.5 : depleted ? 0.08 : 0.2);
      }

      if (planet.turretAsset) {
        planet.turretAsset.visible = planet.structures.turret > 0;
        const orbitRadius = planet.turretAsset.userData.orbitRadius ?? 10.1;
        planet.turretAsset.userData.orbitAngle += dt * (planet.turretAsset.userData.orbitSpeed ?? 0.18);
        planet.turretAsset.position.set(
          planet.x + Math.cos(planet.turretAsset.userData.orbitAngle) * orbitRadius,
          planet.y + 1.6,
          planet.z + Math.sin(planet.turretAsset.userData.orbitAngle) * orbitRadius
        );
        planet.turretAsset.rotation.y = planet.turretAsset.userData.orbitAngle + Math.PI / 2;
        planet.turretAsset.scale.setScalar(depleted ? 0.78 : 1);
        tintAsset(planet.turretAsset, baseColor, depleted ? 0.08 : 0.24);
      }

      if (planet.factoryLightGroup) {
        const hasFactory = planet.structures.factory > 0;
        const hpFrac = Math.max(0, Math.min(1, planet.factoryHp / 100));
        const alertMode = contested || planet.stalled || hpFrac < 0.45;
        const blinkRate = contested ? 10.5 : planet.stalled ? 7.5 : hpFrac < 0.45 ? 6.2 : 2.4;
        const lightPulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(performance.now() / (1000 / blinkRate)));
        planet.factoryLightGroup.visible = hasFactory;
        planet.factoryLightGroup.position.set(planet.x, planet.y, planet.z);
        planet.factoryLightGroup.rotation.y += dt * 0.4;
        const orbitRadius = planet.structureAsset?.userData.orbitRadius ?? 7.6;
        for (const child of planet.factoryLightGroup.children) {
          const phase = child.userData.phase ?? 0;
          const x = Math.cos(planet.factoryLightGroup.rotation.y + phase) * orbitRadius;
          const z = Math.sin(planet.factoryLightGroup.rotation.y + phase) * orbitRadius;
          child.position.set(x, 1.8, z);
          child.material.color.set(contested ? 0xff9a76 : planet.stalled ? 0xff8a5b : baseColor);
          child.material.opacity = hasFactory ? (alertMode ? 0.22 + lightPulse * 0.78 : 0.28 + lightPulse * 0.34) : 0;
          child.scale.setScalar(alertMode ? 0.8 + lightPulse * 0.8 : 0.75 + lightPulse * 0.35);
        }
      }

      if (planet.factoryLight) {
        const hasFactory = planet.structures.factory > 0;
        const hpFrac = Math.max(0, Math.min(1, planet.factoryHp / 100));
        const urgency = contested ? 1 : planet.stalled ? 0.8 : hpFrac < 0.45 ? 0.55 : 0.2;
        const pulse = 0.55 + 0.45 * Math.sin(performance.now() / (contested ? 85 : planet.stalled ? 120 : 260));
        planet.factoryLight.visible = hasFactory;
        planet.factoryLight.color.set(contested ? 0xffb199 : planet.stalled ? 0xff8d57 : baseColor);
        planet.factoryLight.intensity = hasFactory ? 1.4 + urgency * 1.5 + Math.max(0, pulse) * (0.4 + urgency * 1.2) : 0;
        planet.factoryLight.distance = contested ? 185 : 150;
        planet.factoryLight.position.set(planet.x, planet.y + 14, planet.z);
      }

      if (planet.factoryIcon) {
        const hasFactory = planet.structures.factory > 0;
        const hpFrac = Math.max(0, Math.min(1, planet.factoryHp / 100));
        const pulse = 0.72 + Math.sin(performance.now() / 110) * 0.28;
        planet.factoryIcon.visible = hasFactory;
        planet.factoryIcon.position.y = planet.y + baseSize + 1.4;
        planet.factoryIcon.scale.setScalar(hasFactory ? Math.max(0.3, 0.55 + hpFrac * 0.65) : 0.001);
        planet.factoryIcon.material.color.set(baseColor);
        planet.factoryIcon.material.opacity = hasFactory ? (hpFrac < 0.45 ? 0.35 + Math.max(0, pulse) * 0.55 : 0.88) : 0;
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

export function createPlanetFlashEffect(planet: any, kind = 'damage') {
  const destroyed = kind === 'destroyed';
  const mesh = new Mesh(
    new SphereGeometry(1.2, 16, 16),
    new MeshBasicMaterial({
      color: destroyed ? 0xff6a4d : 0xffc27a,
      transparent: true,
      opacity: destroyed ? 0.85 : 0.48,
      depthWrite: false,
    })
  );
  mesh.position.set(planet.x, planet.y, planet.z);
  const baseScale = destroyed ? 8.8 : 5.8;
  mesh.scale.setScalar(baseScale);
  return {
    mesh,
    life: destroyed ? 0.42 : 0.18,
    maxLife: destroyed ? 0.42 : 0.18,
    update(progress: number) {
      const t = Math.max(0, Math.min(1, progress));
      const fade = t * t;
      mesh.scale.setScalar(baseScale + (1 - t) * (destroyed ? 4.2 : 1.6));
      mesh.material.opacity = (destroyed ? 0.9 : 0.5) * fade;
    },
    dispose() {
      mesh.geometry.dispose();
      mesh.material.dispose();
    },
  };
}

function tintAsset(root: any, colorValue: any, emissiveIntensity = 0.2) {
  const color = new Color(colorValue);
  root.traverse((node: any) => {
    if (!node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if ('color' in material && material.color) material.color.lerp(color, 0.35);
      if ('emissive' in material && material.emissive) material.emissive.copy(color).multiplyScalar(emissiveIntensity);
      if ('emissiveIntensity' in material) material.emissiveIntensity = Math.max(material.emissiveIntensity ?? 0, emissiveIntensity);
    }
  });
}
function tickDecorRings(planet: any, dt: number) {
  for (const ring of planet.decorRings ?? []) {
    ring.mesh.rotation[ring.axis] += dt * ring.speed;
  }
}

function createLabelSprite(text: string) {
  const texture = new CanvasTexture(document.createElement('canvas'));
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  const material = new SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new Sprite(material);
  sprite.scale.set(13.8, 3.6, 1);
  updateLabelSprite(sprite, text);
  return sprite;
}

function updateLabelSprite(sprite: any, text: string) {
  const canvas = sprite.material.map.image;
  const ctx = canvas.getContext('2d');
  canvas.width = 256;
  canvas.height = 72;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(7, 14, 24, 0.84)';
  ctx.fillRect(8, 10, 240, 52);
  ctx.strokeStyle = 'rgba(166, 224, 255, 0.26)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(8, 10, 240, 52);
  ctx.fillStyle = '#d9e8f1';
  ctx.font = 'bold 22px monospace';
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
      // Spread the field vertically so the star backdrop reads as a 3D volume.
      y = (rng() - 0.5) * (260 + radius * 0.42);
    } else {
      const theta = rng() * Math.PI * 2;
      const phi = Math.acos(2 * rng() - 1);
      const radius = 520 + rng() * 640;
      x = radius * Math.sin(phi) * Math.cos(theta);
      y = radius * Math.cos(phi) * 0.82;
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

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('color', new BufferAttribute(cols, 3));
  scene.add(new Points(
    geo,
    new PointsMaterial({ vertexColors: true, size: 1.2, transparent: true, opacity: 0.58, sizeAttenuation: true })
  ));
}
