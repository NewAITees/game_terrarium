import { DIRS, ITEM_DEFS, randInt, type Direction, type EquipSlot, type ItemType, type Monster } from './engine_types.js';

export function getCell(engine: any, x: number, y: number): string {
  const { width, height, cells } = engine.map;
  if (x < 0 || y < 0 || x >= width || y >= height) return 'wall';
  return cells[y][x];
}

export function getMonsterAt(engine: any, x: number, y: number): Monster | null {
  return engine.entities.find((entity: any) => entity.x === x && entity.y === y) || null;
}

export function getItemAt(engine: any, x: number, y: number): any {
  return engine.items.find((item: any) => item.x === x && item.y === y) || null;
}

export function calcPlayerDamage(engine: any): number {
  const [min, max] = engine.player.baseAttack;
  const bonus = engine.player.weapon ? ITEM_DEFS[engine.player.weapon]?.attackBonus || 0 : 0;
  return Math.max(1, randInt(min, max) + bonus);
}

export function calcPlayerDefense(engine: any): number {
  const bonus = engine.player.armor ? ITEM_DEFS[engine.player.armor]?.defenseBonus || 0 : 0;
  return engine.player.baseDefense + bonus;
}

export function moveMonsterToward(engine: any, monster: Monster): void {
  const dx = engine.player.x - monster.x;
  const dy = engine.player.y - monster.y;
  const candidates = [];
  if (dx !== 0) candidates.push({ x: monster.x + Math.sign(dx), y: monster.y });
  if (dy !== 0) candidates.push({ x: monster.x, y: monster.y + Math.sign(dy) });
  for (const pos of candidates) {
    if (getCell(engine, pos.x, pos.y) === 'wall') continue;
    if (getMonsterAt(engine, pos.x, pos.y)) continue;
    if (pos.x === engine.player.x && pos.y === engine.player.y) continue;
    monster.x = pos.x;
    monster.y = pos.y;
    break;
  }
}

export function monsterTurns(engine: any): Record<string, any> {
  const events = [];
  for (const monster of engine.entities) {
    const dist = Math.abs(monster.x - engine.player.x) + Math.abs(monster.y - engine.player.y);
    if (dist === 1) {
      const rawDmg = randInt(monster.attack[0], monster.attack[1]);
      const dmg = Math.max(1, rawDmg - calcPlayerDefense(engine));
      engine.player.hp -= dmg;
      engine.addLog(`${monster.type} hits you for ${dmg} dmg. (${engine.player.hp}/${engine.player.maxHp} HP)`);
      events.push({ event: 'hit', monster: monster.type, damage: dmg });
      if (engine.player.hp <= 0) {
        engine.player.hp = 0;
        engine.gameOver = true;
        engine.addLog('You have died. Game over.');
        events.push({ event: 'game_over' });
        return { monsterEvents: events };
      }
    } else if (dist <= 6) {
      moveMonsterToward(engine, monster);
    }
  }
  return { monsterEvents: events };
}

export function doMove(engine: any, dir: Direction): Record<string, any> {
  const direction = DIRS[dir];
  if (!direction) return { error: `unknown direction: ${dir}` };
  const nx = engine.player.x + direction.dx;
  const ny = engine.player.y + direction.dy;
  if (getCell(engine, nx, ny) === 'wall') return { error: 'wall' };
  if (getMonsterAt(engine, nx, ny)) return { error: 'monster blocking — use attack' };
  engine.player.x = nx;
  engine.player.y = ny;
  engine.addLog(`You move ${dir}.`);
  return { moved: dir, ...monsterTurns(engine) };
}

export function doAttack(engine: any, dir: Direction): Record<string, any> {
  const direction = DIRS[dir];
  if (!direction) return { error: `unknown direction: ${dir}` };
  const nx = engine.player.x + direction.dx;
  const ny = engine.player.y + direction.dy;
  const monster = getMonsterAt(engine, nx, ny);
  if (!monster) return { error: 'no monster there' };

  const dmg = Math.max(1, calcPlayerDamage(engine) - monster.defense);
  monster.hp -= dmg;
  engine.addLog(`You hit ${monster.type} for ${dmg} dmg. (${monster.hp}/${monster.maxHp} HP left)`);

  if (monster.hp <= 0) {
    engine.entities = engine.entities.filter((entity: any) => entity.id !== monster.id);
    engine.score += monster.reward;
    engine.addLog(`${monster.type} defeated! +${monster.reward} score`);
    return { killed: monster.type, scoreGained: monster.reward, ...monsterTurns(engine) };
  }

  return { attacked: monster.type, damageDealt: dmg, ...monsterTurns(engine) };
}

export function doPickup(engine: any): Record<string, any> {
  const item = getItemAt(engine, engine.player.x, engine.player.y);
  if (!item) return { error: 'nothing here' };
  if (item.type === 'gold') {
    const amount = randInt(5, 15);
    engine.player.gold += amount;
    engine.score += amount;
    engine.items = engine.items.filter((entry: any) => entry.id !== item.id);
    engine.addLog(`Picked up ${amount} gold. +${amount} score`);
    return { pickedUp: 'gold', amount };
  }
  engine.player.inventory.push(item.type);
  engine.items = engine.items.filter((entry: any) => entry.id !== item.id);
  engine.addLog(`Picked up ${item.type}.`);
  return { pickedUp: item.type };
}

export function doUseItem(engine: any, itemType: ItemType): Record<string, any> {
  if (!engine.player.inventory.includes(itemType)) return { error: `no ${itemType} in inventory` };
  if (itemType === 'potion') {
    const heal = randInt(5, 10);
    const before = engine.player.hp;
    engine.player.hp = Math.min(engine.player.maxHp, engine.player.hp + heal);
    engine.player.inventory.splice(engine.player.inventory.indexOf('potion'), 1);
    engine.addLog(`Used potion. +${engine.player.hp - before} HP.`);
    return { used: 'potion', healed: engine.player.hp - before };
  }
  return { error: `${itemType} cannot be used` };
}

export function doEquip(engine: any, itemType: ItemType): Record<string, any> {
  if (!engine.player.inventory.includes(itemType)) return { error: `no ${itemType} in inventory` };
  const def = ITEM_DEFS[itemType];
  if (!def?.equipable) return { error: `${itemType} cannot be equipped` };
  const slot = def.slot as EquipSlot;
  const old = engine.player[slot];
  if (old) engine.player.inventory.push(old);
  engine.player[slot] = itemType;
  engine.player.inventory.splice(engine.player.inventory.indexOf(itemType), 1);
  engine.addLog(`Equipped ${itemType}${old ? ` (unequipped ${old})` : ''}.`);
  return { equipped: itemType };
}

export function doDescend(engine: any): Record<string, any> {
  if (getCell(engine, engine.player.x, engine.player.y) !== 'exit') return { error: 'not on exit (>)' };
  engine.floorNum += 1;
  engine.score += 100;
  engine.addLog(`Descended to floor ${engine.floorNum}! +100 score`);
  engine.generateFloor();
  return { descended: true, floor: engine.floorNum };
}

export function processAction(engine: any, action: string, params: Record<string, any> = {}): Record<string, any> {
  if (engine.gameOver) return { error: 'game over — POST /reset to restart' };
  switch (action) {
    case 'move':
      return doMove(engine, params.dir);
    case 'attack':
      return doAttack(engine, params.dir);
    case 'pickup':
      return doPickup(engine);
    case 'use_item':
      return doUseItem(engine, params.item);
    case 'equip':
      return doEquip(engine, params.item);
    case 'descend':
      return doDescend(engine);
    default:
      return { error: `unknown action: ${action}` };
  }
}

export function getSurroundings(engine: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [dir, { dx, dy }] of Object.entries(DIRS)) {
    const nx = engine.player.x + dx;
    const ny = engine.player.y + dy;
    const monster = getMonsterAt(engine, nx, ny);
    const item = getItemAt(engine, nx, ny);
    if (monster) out[dir] = `monster:${monster.type}(hp:${monster.hp}/${monster.maxHp})`;
    else if (item) out[dir] = `item:${item.type}`;
    else out[dir] = getCell(engine, nx, ny);
  }
  return out;
}

export function getAvailableActions(engine: any): Array<Record<string, string>> {
  const actions: Array<Record<string, string>> = [];
  const { x, y } = engine.player;
  for (const [dir, { dx, dy }] of Object.entries(DIRS)) {
    const nx = x + dx;
    const ny = y + dy;
    if (getMonsterAt(engine, nx, ny)) actions.push({ action: 'attack', dir });
    else if (getCell(engine, nx, ny) !== 'wall') actions.push({ action: 'move', dir });
  }
  if (getItemAt(engine, x, y)) actions.push({ action: 'pickup' });
  if (getCell(engine, x, y) === 'exit') actions.push({ action: 'descend' });
  for (const item of engine.player.inventory) {
    if (ITEM_DEFS[item]?.usable) actions.push({ action: 'use_item', item });
    if (ITEM_DEFS[item]?.equipable) actions.push({ action: 'equip', item });
  }
  return actions;
}

export function getAIState(engine: any): Record<string, any> {
  return {
    floor: engine.floorNum,
    score: engine.score,
    gameOver: engine.gameOver,
    player: {
      hp: engine.player.hp,
      maxHp: engine.player.maxHp,
      inventory: [...engine.player.inventory],
      weapon: engine.player.weapon,
      armor: engine.player.armor,
      gold: engine.player.gold,
    },
    currentCell: getCell(engine, engine.player.x, engine.player.y),
    surroundings: getSurroundings(engine),
    availableActions: getAvailableActions(engine),
    recentLog: engine.log.slice(-6),
  };
}

export function getFullState(engine: any): Record<string, any> {
  const ai = getAIState(engine);
  return {
    ...ai,
    player: { ...ai.player, x: engine.player.x, y: engine.player.y },
    map: engine.map,
    entities: engine.entities,
    items: engine.items,
    fullLog: engine.log,
  };
}
