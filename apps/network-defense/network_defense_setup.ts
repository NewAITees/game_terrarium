import { RNG } from '../../shared/network-core.js';
import {
  createNetworkDefenseFlashPools,
  initializeNetworkDefenseRender,
} from './network_defense_render.js';
import { pickRankPersonalities } from './network_defense_personality.js';
import { initializeNetworkDefenseSimulationState } from './network_defense_simulation_setup.js';
import { createNetworkDefenseThreeVisualAdapter } from './network_defense_three_visual_adapter.js';

export function initializeNetworkDefenseSetup(observerMode: boolean) {
  const total = 24 + (Math.random() * 16 | 0);
  const seed = Math.random() * 1e9 | 0;
  const render = initializeNetworkDefenseRender({
    total,
    seed,
    rewirePct: 28,
    background: 0x0d2040,
    observerMode,
    lowLoadMode: false,
  });
  const personalityRng = new RNG(seed + 1);
  const rankPersonalities = observerMode ? pickRankPersonalities(personalityRng) : null;
  const simulation = initializeNetworkDefenseSimulationState({
    topo: render.topo,
    edgeMap: render.edgeMap,
    allEdges: render.allEdges,
    seed,
    rng: personalityRng,
    observerMode,
    rankPersonalities,
    attachNodeVisual: (node) => {
      node.material = node.mesh.material;
      node.halo = node.mesh.children[0];
      node.mesh.userData.node = node;
      render.clickable.push(node.mesh);
    },
  });
  const { attackPool, normalPool, triggerFlash } = createNetworkDefenseFlashPools(render.scene);
  const visuals = createNetworkDefenseThreeVisualAdapter(render.scene);
  return {
    ...simulation,
    attackPool,
    normalPool,
    rankPersonalities,
    render,
    triggerFlash,
    visuals,
  };
}
