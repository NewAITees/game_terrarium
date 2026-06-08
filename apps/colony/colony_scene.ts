import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export function createColonyScene({ bg, factions, innerHeight, innerWidth, map, rng }: any) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bg);
  scene.fog = new THREE.FogExp2(bg, 0.0026);

  const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.5, 700);
  camera.position.set(0, 130, 72);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  document.body.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 30;
  controls.maxDistance = 280;
  controls.target.set(0, 0, 0);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 1.25, 0.45, 0.08));

  scene.add(new THREE.AmbientLight(0x112233, 4.5));
  const sun = new THREE.DirectionalLight(0xfff0e8, 1.3);
  sun.position.set(20, 60, 30);
  scene.add(sun);

  const grid = new THREE.GridHelper(260, 52, 0x090f1a, 0x060c14);
  grid.position.y = -1.2;
  scene.add(grid);

  const neutralColor = new THREE.Color(0x2a3a4a);
  const contestedColor = new THREE.Color(0xf0a020);
  const factionColors = factions.map((f: any) => new THREE.Color(f.color));
  const factionEmissiveColors = factions.map((f: any) => new THREE.Color(f.emCol));
  const edgeMatNeutral = new THREE.LineBasicMaterial({ color: 0x182838, transparent: true, opacity: 0.35 });
  const edgeMatFaction = factions.map((f: any) =>
    new THREE.LineBasicMaterial({ color: f.color, transparent: true, opacity: 0.55 })
  );

  buildNodeMeshes({ factionColors, factions, map, neutralColor, scene });
  buildEdgeLines({ edgeMatNeutral, map, scene });

  const { spawnPulse, tickPulses } = createPulseSystem({ factions, rng, scene });

  return {
    camera,
    composer,
    contestedColor,
    controls,
    edgeMatFaction,
    edgeMatNeutral,
    factionColors,
    factionEmissiveColors,
    neutralColor,
    renderer,
    scene,
    spawnPulse,
    tickPulses,
  };
}

function buildNodeMeshes({ factionColors, factions, map, neutralColor, scene }: any) {
  const nodeRadius = 3.6;
  const baseRadius = 5.0;

  for (const node of map.nodes) {
    const radius = node.isBase ? baseRadius : nodeRadius;
    const geo = new THREE.CylinderGeometry(radius, radius * 1.08, 0.9, 16);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(neutralColor),
      emissive: new THREE.Color(0),
      emissiveIntensity: 0,
      metalness: 0.35,
      roughness: 0.45,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(node.x, 0, node.z);
    scene.add(mesh);
    node.mesh = mesh;

    const haloGeo = new THREE.SphereGeometry(radius * 1.85, 10, 10);
    const haloMat = new THREE.MeshBasicMaterial({
      color: neutralColor.clone(),
      transparent: true,
      opacity: 0,
      side: THREE.BackSide,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    mesh.add(halo);
    node.halo = halo;

    if (node.food > 26 || node.material > 16) {
      const ringGeo = new THREE.TorusGeometry(radius * 0.55, 0.11, 6, 18);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x80e050, transparent: true, opacity: 0.55 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.65;
      mesh.add(ring);
      node.resourceRing = ring;
    }
  }

  for (const faction of factions) {
    const base = faction.baseNode;
    for (let i = 0; i < 2; i++) {
      const ringGeo = new THREE.TorusGeometry(baseRadius * 1.35 + i * 1.6, 0.09, 6, 26);
      const ringMat = new THREE.MeshBasicMaterial({
        color: factionColors[faction.id] ?? new THREE.Color(faction.color),
        transparent: true,
        opacity: 0.4,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(base.x, 0.4, base.z);
      scene.add(ring);
    }
  }
}

function buildEdgeLines({ edgeMatNeutral, map, scene }: any) {
  for (const edge of map.edges) {
    const pts = [
      new THREE.Vector3(edge.a.x, 0.5, edge.a.z),
      new THREE.Vector3(edge.b.x, 0.5, edge.b.z),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, edgeMatNeutral);
    scene.add(line);
    edge.line = line;
  }
}

function createPulseSystem({ factions, rng, scene }: any) {
  const pulses: Array<{ mesh: any; from: any; to: any; t: number; speed: number; factionId: number }> = [];

  function spawnPulse(fromNode: any, toNode: any, factionId: number) {
    const geo = new THREE.SphereGeometry(0.6, 7, 7);
    const mat = new THREE.MeshBasicMaterial({ color: factions[factionId].color });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    pulses.push({ mesh, from: fromNode, to: toNode, t: 0, speed: 0.9 + rng.next() * 0.4, factionId });
  }

  function tickPulses(dt: number) {
    for (let i = pulses.length - 1; i >= 0; i--) {
      const pulse = pulses[i];
      pulse.t += dt * pulse.speed;
      if (pulse.t >= 1) {
        scene.remove(pulse.mesh);
        pulse.mesh.geometry.dispose();
        pulse.mesh.material.dispose();
        pulses.splice(i, 1);
        continue;
      }
      pulse.mesh.position.lerpVectors(
        new THREE.Vector3(pulse.from.x, 0.5, pulse.from.z),
        new THREE.Vector3(pulse.to.x, 0.5, pulse.to.z),
        pulse.t
      );
    }
  }

  return { spawnPulse, tickPulses };
}
