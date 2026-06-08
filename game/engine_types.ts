export type Direction = 'north' | 'south' | 'east' | 'west';
export type MonsterType = 'goblin' | 'orc' | 'troll';
export type ItemType = 'potion' | 'sword' | 'shield' | 'gold';
export type EquipSlot = 'weapon' | 'armor';

export type ItemDef = {
  usable?: boolean;
  equipable?: boolean;
  pickup?: boolean;
  slot: EquipSlot | null;
  attackBonus: number;
  defenseBonus: number;
};

export type Monster = {
  id: string;
  type: MonsterType;
  hp: number;
  maxHp: number;
  attack: number[];
  defense: number;
  reward: number;
  x: number;
  y: number;
};

export type Item = {
  id: string;
  type: ItemType;
  x: number;
  y: number;
};

export type Player = {
  hp: number;
  maxHp: number;
  baseAttack: number[];
  baseDefense: number;
  x: number;
  y: number;
  inventory: ItemType[];
  weapon: ItemType | null;
  armor: ItemType | null;
  gold: number;
};

export type MapState = {
  width: number;
  height: number;
  cells: string[][];
};

export function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export const DIRS: Record<Direction, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

export const MONSTER_DEFS: Record<MonsterType, { maxHp: number; attack: number[]; defense: number; reward: number }> = {
  goblin: { maxHp: 6, attack: [1, 3], defense: 0, reward: 10 },
  orc: { maxHp: 12, attack: [2, 5], defense: 1, reward: 25 },
  troll: { maxHp: 20, attack: [3, 6], defense: 2, reward: 50 },
};

export const ITEM_DEFS: Record<ItemType, ItemDef> = {
  potion: { usable: true, slot: null, attackBonus: 0, defenseBonus: 0 },
  sword: { equipable: true, slot: 'weapon', attackBonus: 3, defenseBonus: 0 },
  shield: { equipable: true, slot: 'armor', attackBonus: 0, defenseBonus: 2 },
  gold: { pickup: true, slot: null, attackBonus: 0, defenseBonus: 0 },
};
