// Barrel module: re-exports the split drone-bastion modules so existing imports of
// `drone_bastion_core.js` (agent, episode, render scene, DQN agent, experiment adapter, headless
// sim, tests) keep working unchanged. See drone_bastion_types/math/state/observation/step for the
// actual code.
export type {
  BastionDamageNumber,
  BastionDrone,
  BastionEffect,
  BastionEnemy,
  BastionProjectile,
  BastionWall,
  DroneAction,
  DroneBastionObservation,
  DroneBastionRewardWeights,
  DroneBastionState,
  DroneBastionStepResult,
  DroneChassis,
  DroneKind,
  DroneMode,
  DroneWeapon,
  WeaponResult,
} from './drone_bastion_types.js';
export { DEFAULT_DRONE_BASTION_REWARD_WEIGHTS } from './drone_bastion_types.js';

export {
  applyBastionUpgrade,
  createDroneBastionState,
  getDroneRadius,
  getDroneVisualProfile,
  resetDroneBastionEpisode,
} from './drone_bastion_state.js';

export { encodeDroneBastionObservation, observeDroneBastion } from './drone_bastion_observation.js';

export { stepDroneBastion } from './drone_bastion_step.js';
