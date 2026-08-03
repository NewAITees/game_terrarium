export type ZombieHudElements = {
  wave: HTMLElement;
  time: HTMLElement;
  level: HTMLElement;
  kills: HTMLElement;
  food: HTMLElement;
  fuel: HTMLElement;
  scrap: HTMLElement;
  hp: HTMLElement;
  xp: HTMLElement;
  weapon: HTMLElement;
  ammo: HTMLElement;
  action: HTMLElement;
  death: HTMLElement;
  boost: HTMLElement;
  edge: HTMLElement;
  stamina: HTMLElement;
  work: HTMLElement;
};

export type ZombieHudState = {
  wave: number;
  waveTime: number;
  level: number;
  kills: number;
  food: number;
  fuel: number;
  scrap: number;
  hp: number;
  xp: number;
  nextXp: number;
  weapon: { name: string; kind: string; ammo: number; maxAmmo: number };
  action: string;
  deathReason: string;
  boostCooldown: number;
  stamina: number;
  edgeDistance: number;
};

export function updateZombieHud(elements: ZombieHudElements, state: ZombieHudState): void {
  elements.wave.textContent = String(state.wave);
  elements.death.textContent = state.deathReason;
  elements.time.textContent = elements.work.classList.contains('open')
    ? 'WORK'
    : `${Math.max(0, 35 - state.waveTime).toFixed(1)}s`;
  elements.level.textContent = String(state.level);
  elements.kills.textContent = String(state.kills);
  elements.food.textContent = String(state.food);
  elements.fuel.textContent = String(state.fuel);
  elements.scrap.textContent = String(state.scrap);
  elements.hp.textContent = `${Math.max(0, Math.round(state.hp))}/100`;
  elements.xp.textContent = `${state.xp}/${state.nextXp}`;
  elements.weapon.textContent = state.weapon.name;
  elements.ammo.textContent = state.weapon.kind === 'melee'
    ? '∞'
    : `${state.weapon.ammo}/${state.weapon.maxAmmo}`;
  elements.action.textContent = state.action;
  elements.boost.textContent = state.boostCooldown
    ? `COOLDOWN ${state.boostCooldown.toFixed(1)}`
    : 'READY';
  elements.stamina.textContent = `${Math.round(state.stamina)}/100`;
  elements.edge.textContent = state.edgeDistance < 45
    ? 'DANGER'
    : state.edgeDistance < 100
    ? 'CAUTION'
    : 'SAFE';
}
