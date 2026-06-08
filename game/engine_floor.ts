import { MONSTER_DEFS, randInt, type ItemType, type MonsterType } from './engine_types.js';

export function initializePlayer() {
  return {
    hp: 20,
    maxHp: 20,
    baseAttack: [3, 6],
    baseDefense: 1,
    x: 2,
    y: 2,
    inventory: [],
    weapon: null,
    armor: null,
    gold: 0,
  };
}

export function randomFloorPos(engine: any, minDist = 0): { x: number; y: number } | null {
  const { width, height, cells } = engine.map;
  for (let attempt = 0; attempt < 200; attempt++) {
    const x = randInt(1, width - 2);
    const y = randInt(1, height - 2);
    if (cells[y][x] !== 'floor') continue;
    if (engine.getMonsterAt(x, y)) continue;
    if (engine.getItemAt(x, y)) continue;
    if (x === engine.player.x && y === engine.player.y) continue;
    if (Math.abs(x - engine.player.x) + Math.abs(y - engine.player.y) < minDist) continue;
    return { x, y };
  }
  return null;
}

export function generateFloor(engine: any): void {
  const W = 11;
  const H = 11;
  engine.map = {
    width: W,
    height: H,
    cells: Array.from({ length: H }, () => Array(W).fill('wall')),
  };

  const rooms: Array<{ cx: number; cy: number }> = [];

  const carveRoom = (x: number, y: number, w: number, h: number) => {
    for (let ry = y; ry < Math.min(y + h, H - 1); ry++) {
      for (let rx = x; rx < Math.min(x + w, W - 1); rx++) {
        engine.map.cells[ry][rx] = 'floor';
      }
    }
    rooms.push({ cx: Math.floor(x + w / 2), cy: Math.floor(y + h / 2) });
  };

  const carveCorridor = (x1: number, y1: number, x2: number, y2: number) => {
    let x = x1;
    while (x !== x2) {
      engine.map.cells[y1][x] = 'floor';
      x += x < x2 ? 1 : -1;
    }
    let y = y1;
    while (y !== y2) {
      engine.map.cells[y][x2] = 'floor';
      y += y < y2 ? 1 : -1;
    }
  };

  carveRoom(1, 1, 3, 3);
  carveRoom(7, 7, 3, 3);

  const extraCount = randInt(1, 2);
  for (let i = 0; i < extraCount; i++) {
    carveRoom(randInt(2, 6), randInt(2, 6), randInt(2, 3), randInt(2, 3));
  }

  for (let i = 1; i < rooms.length; i++) {
    carveCorridor(rooms[i - 1].cx, rooms[i - 1].cy, rooms[i].cx, rooms[i].cy);
  }

  engine.map.cells[8][8] = 'exit';
  engine.player.x = 2;
  engine.player.y = 2;
  engine.entities = [];
  engine.items = [];

  const pool: MonsterType[] = ['goblin', 'goblin', 'orc'];
  if (engine.floorNum >= 3) pool.push('troll');
  const monsterCount = 2 + Math.min(engine.floorNum - 1, 3);
  for (let i = 0; i < monsterCount; i++) {
    const type = pool[randInt(0, pool.length - 1)];
    const def = MONSTER_DEFS[type];
    const pos = randomFloorPos(engine, 5);
    if (pos) {
      engine.entities.push({
        id: `m${i}`,
        type,
        hp: def.maxHp,
        maxHp: def.maxHp,
        attack: def.attack,
        defense: def.defense,
        reward: def.reward,
        x: pos.x,
        y: pos.y,
      });
    }
  }

  const itemPool: ItemType[] = ['potion', 'potion', 'sword', 'shield', 'gold', 'gold'];
  const itemCount = 3 + randInt(0, 1);
  for (let i = 0; i < itemCount; i++) {
    const type = itemPool[randInt(0, itemPool.length - 1)];
    const pos = randomFloorPos(engine, 2);
    if (pos) engine.items.push({ id: `i${i}`, type, x: pos.x, y: pos.y });
  }

  engine.addLog(`=== Floor ${engine.floorNum} ===`);
}
