// Barrel module: re-exports the split arena-shooter modules so existing imports of
// `arena_shooter_core.js` (episode runner, agent, render, experiment adapter) keep working
// unchanged. See arena_shooter_types/actions/state/observation/step/math for the actual code.
export type {
  ArenaAction,
  ArenaObservation,
  ArenaObservationVariant,
  ArenaRewardWeights,
  ArenaState,
  ArenaStepResult,
  BeamEffect,
  CraftPreference,
  CraftType,
  DamageNumber,
  Enemy,
  Particle,
  Projectile,
  Ship,
  TrailField,
  Vec2,
} from './arena_shooter_types.js';
export { ARENA_OBSERVATIONS, DEFAULT_ARENA_REWARD_WEIGHTS } from './arena_shooter_types.js';

export { ACTIONS, craftLabel, isActionAllowed } from './arena_shooter_actions.js';

export {
  createArenaState,
  getArenaCamera,
  nextArenaRandom,
  prepareArenaWave,
  resetEpisode,
  resizeArena,
  setCraftPreference,
} from './arena_shooter_state.js';

export { encodeObservation, encodeObservationVariant, observeArena } from './arena_shooter_observation.js';

export { stepArena } from './arena_shooter_step.js';
