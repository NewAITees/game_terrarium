function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

const DIRS = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east:  { dx: 1,  dy: 0 },
  west:  { dx: -1, dy: 0 },
};

// Internal definitions — not exposed to AI
const MONSTER_DEFS = {
  goblin: { maxHp: 6,  attack: [1, 3], defense: 0, reward: 10 },
  orc:    { maxHp: 12, attack: [2, 5], defense: 1, reward: 25 },
  troll:  { maxHp: 20, attack: [3, 6], defense: 2, reward: 50 },
};

const ITEM_DEFS = {
  potion: { usable: true,    slot: null,     attackBonus: 0, defenseBonus: 0 },
  sword:  { equipable: true, slot: 'weapon', attackBonus: 3, defenseBonus: 0 },
  shield: { equipable: true, slot: 'armor',  attackBonus: 0, defenseBonus: 2 },
  gold:   { pickup: true,    slot: null,     attackBonus: 0, defenseBonus: 0 },
};

class GameEngine {
  constructor() {
    this.reset();
  }

  reset() {
    this.floorNum = 1;
    this.score = 0;
    this.gameOver = false;
    this.log = [];
    this.player = {
      hp: 20, maxHp: 20,
      baseAttack: [3, 6],
      baseDefense: 1,
      x: 2, y: 2,
      inventory: [],
      weapon: null,
      armor: null,
      gold: 0,
    };
    this.generateFloor();
  }

  addLog(msg) {
    this.log.push(msg);
    if (this.log.length > 100) this.log.shift();
  }

  generateFloor() {
    const W = 11, H = 11;
    this.map = {
      width: W, height: H,
      cells: Array.from({ length: H }, () => Array(W).fill('wall')),
    };

    const rooms = [];

    const carveRoom = (x, y, w, h) => {
      for (let ry = y; ry < Math.min(y + h, H - 1); ry++) {
        for (let rx = x; rx < Math.min(x + w, W - 1); rx++) {
          this.map.cells[ry][rx] = 'floor';
        }
      }
      rooms.push({ cx: Math.floor(x + w / 2), cy: Math.floor(y + h / 2) });
    };

    const carveCorridor = (x1, y1, x2, y2) => {
      let x = x1;
      while (x !== x2) {
        this.map.cells[y1][x] = 'floor';
        x += x < x2 ? 1 : -1;
      }
      let y = y1;
      while (y !== y2) {
        this.map.cells[y][x2] = 'floor';
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

    this.map.cells[8][8] = 'exit';
    this.player.x = 2;
    this.player.y = 2;

    this.entities = [];
    this.items = [];
    const pool = ['goblin', 'goblin', 'orc'];
    if (this.floorNum >= 3) pool.push('troll');
    const monsterCount = 2 + Math.min(this.floorNum - 1, 3);
    for (let i = 0; i < monsterCount; i++) {
      const type = pool[randInt(0, pool.length - 1)];
      const def = MONSTER_DEFS[type];
      const pos = this.randomFloorPos(5);
      if (pos) {
        this.entities.push({
          id: `m${i}`, type,
          hp: def.maxHp, maxHp: def.maxHp,
          attack: def.attack, defense: def.defense, reward: def.reward,
          x: pos.x, y: pos.y,
        });
      }
    }

    this.items = [];
    const itemPool = ['potion', 'potion', 'sword', 'shield', 'gold', 'gold'];
    const itemCount = 3 + randInt(0, 1);
    for (let i = 0; i < itemCount; i++) {
      const type = itemPool[randInt(0, itemPool.length - 1)];
      const pos = this.randomFloorPos(2);
      if (pos) this.items.push({ id: `i${i}`, type, x: pos.x, y: pos.y });
    }

    this.addLog(`=== Floor ${this.floorNum} ===`);
  }

  randomFloorPos(minDist = 0) {
    const { width, height, cells } = this.map;
    for (let attempt = 0; attempt < 200; attempt++) {
      const x = randInt(1, width - 2);
      const y = randInt(1, height - 2);
      if (cells[y][x] !== 'floor') continue;
      if (this.getMonsterAt(x, y)) continue;
      if (this.getItemAt(x, y)) continue;
      if (x === this.player.x && y === this.player.y) continue;
      if (Math.abs(x - this.player.x) + Math.abs(y - this.player.y) < minDist) continue;
      return { x, y };
    }
    return null;
  }

  getCell(x, y) {
    const { width, height, cells } = this.map;
    if (x < 0 || y < 0 || x >= width || y >= height) return 'wall';
    return cells[y][x];
  }

  getMonsterAt(x, y) {
    return this.entities.find(e => e.x === x && e.y === y) || null;
  }

  getItemAt(x, y) {
    return this.items.find(i => i.x === x && i.y === y) || null;
  }

  calcPlayerDamage() {
    const [min, max] = this.player.baseAttack;
    const bonus = this.player.weapon ? (ITEM_DEFS[this.player.weapon]?.attackBonus || 0) : 0;
    return Math.max(1, randInt(min, max) + bonus);
  }

  calcPlayerDefense() {
    const bonus = this.player.armor ? (ITEM_DEFS[this.player.armor]?.defenseBonus || 0) : 0;
    return this.player.baseDefense + bonus;
  }

  processAction(action, params = {}) {
    if (this.gameOver) return { error: 'game over — POST /reset to restart' };
    switch (action) {
      case 'move':     return this.doMove(params.dir);
      case 'attack':   return this.doAttack(params.dir);
      case 'pickup':   return this.doPickup();
      case 'use_item': return this.doUseItem(params.item);
      case 'equip':    return this.doEquip(params.item);
      case 'descend':  return this.doDescend();
      default:         return { error: `unknown action: ${action}` };
    }
  }

  doMove(dir) {
    const d = DIRS[dir];
    if (!d) return { error: `unknown direction: ${dir}` };
    const nx = this.player.x + d.dx;
    const ny = this.player.y + d.dy;
    if (this.getCell(nx, ny) === 'wall') return { error: 'wall' };
    if (this.getMonsterAt(nx, ny)) return { error: 'monster blocking — use attack' };
    this.player.x = nx;
    this.player.y = ny;
    this.addLog(`You move ${dir}.`);
    return { moved: dir, ...this.monsterTurns() };
  }

  doAttack(dir) {
    const d = DIRS[dir];
    if (!d) return { error: `unknown direction: ${dir}` };
    const nx = this.player.x + d.dx;
    const ny = this.player.y + d.dy;
    const monster = this.getMonsterAt(nx, ny);
    if (!monster) return { error: 'no monster there' };

    const dmg = Math.max(1, this.calcPlayerDamage() - monster.defense);
    monster.hp -= dmg;
    this.addLog(`You hit ${monster.type} for ${dmg} dmg. (${monster.hp}/${monster.maxHp} HP left)`);

    if (monster.hp <= 0) {
      this.entities = this.entities.filter(e => e.id !== monster.id);
      this.score += monster.reward;
      this.addLog(`${monster.type} defeated! +${monster.reward} score`);
      return { killed: monster.type, scoreGained: monster.reward, ...this.monsterTurns() };
    }

    return { attacked: monster.type, damageDealt: dmg, ...this.monsterTurns() };
  }

  monsterTurns() {
    const events = [];
    for (const m of this.entities) {
      const dist = Math.abs(m.x - this.player.x) + Math.abs(m.y - this.player.y);
      if (dist === 1) {
        const rawDmg = randInt(m.attack[0], m.attack[1]);
        const dmg = Math.max(1, rawDmg - this.calcPlayerDefense());
        this.player.hp -= dmg;
        this.addLog(`${m.type} hits you for ${dmg} dmg. (${this.player.hp}/${this.player.maxHp} HP)`);
        events.push({ event: 'hit', monster: m.type, damage: dmg });
        if (this.player.hp <= 0) {
          this.player.hp = 0;
          this.gameOver = true;
          this.addLog('You have died. Game over.');
          events.push({ event: 'game_over' });
          return { monsterEvents: events };
        }
      } else if (dist <= 6) {
        this.moveMonsterToward(m);
      }
    }
    return { monsterEvents: events };
  }

  moveMonsterToward(monster) {
    const dx = this.player.x - monster.x;
    const dy = this.player.y - monster.y;
    const candidates = [];
    if (dx !== 0) candidates.push({ x: monster.x + Math.sign(dx), y: monster.y });
    if (dy !== 0) candidates.push({ x: monster.x, y: monster.y + Math.sign(dy) });
    for (const pos of candidates) {
      if (this.getCell(pos.x, pos.y) === 'wall') continue;
      if (this.getMonsterAt(pos.x, pos.y)) continue;
      if (pos.x === this.player.x && pos.y === this.player.y) continue;
      monster.x = pos.x;
      monster.y = pos.y;
      break;
    }
  }

  doPickup() {
    const item = this.getItemAt(this.player.x, this.player.y);
    if (!item) return { error: 'nothing here' };
    if (item.type === 'gold') {
      const amount = randInt(5, 15);
      this.player.gold += amount;
      this.score += amount;
      this.items = this.items.filter(i => i.id !== item.id);
      this.addLog(`Picked up ${amount} gold. +${amount} score`);
      return { pickedUp: 'gold', amount };
    }
    this.player.inventory.push(item.type);
    this.items = this.items.filter(i => i.id !== item.id);
    this.addLog(`Picked up ${item.type}.`);
    return { pickedUp: item.type };
  }

  doUseItem(itemType) {
    if (!this.player.inventory.includes(itemType)) return { error: `no ${itemType} in inventory` };
    if (itemType === 'potion') {
      const heal = randInt(5, 10);
      const before = this.player.hp;
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
      this.player.inventory.splice(this.player.inventory.indexOf('potion'), 1);
      this.addLog(`Used potion. +${this.player.hp - before} HP.`);
      return { used: 'potion', healed: this.player.hp - before };
    }
    return { error: `${itemType} cannot be used` };
  }

  doEquip(itemType) {
    if (!this.player.inventory.includes(itemType)) return { error: `no ${itemType} in inventory` };
    const def = ITEM_DEFS[itemType];
    if (!def?.equipable) return { error: `${itemType} cannot be equipped` };
    const slot = def.slot;
    const old = this.player[slot];
    if (old) this.player.inventory.push(old);
    this.player[slot] = itemType;
    this.player.inventory.splice(this.player.inventory.indexOf(itemType), 1);
    this.addLog(`Equipped ${itemType}${old ? ` (unequipped ${old})` : ''}.`);
    return { equipped: itemType };
  }

  doDescend() {
    if (this.getCell(this.player.x, this.player.y) !== 'exit') return { error: 'not on exit (>)' };
    this.floorNum += 1;
    this.score += 100;
    this.addLog(`Descended to floor ${this.floorNum}! +100 score`);
    this.generateFloor();
    return { descended: true, floor: this.floorNum };
  }

  getSurroundings() {
    const out = {};
    for (const [dir, { dx, dy }] of Object.entries(DIRS)) {
      const nx = this.player.x + dx;
      const ny = this.player.y + dy;
      const monster = this.getMonsterAt(nx, ny);
      const item = this.getItemAt(nx, ny);
      if (monster) out[dir] = `monster:${monster.type}(hp:${monster.hp}/${monster.maxHp})`;
      else if (item) out[dir] = `item:${item.type}`;
      else out[dir] = this.getCell(nx, ny);
    }
    return out;
  }

  getAvailableActions() {
    const actions = [];
    const { x, y } = this.player;
    for (const [dir, { dx, dy }] of Object.entries(DIRS)) {
      const nx = x + dx, ny = y + dy;
      if (this.getMonsterAt(nx, ny)) actions.push({ action: 'attack', dir });
      else if (this.getCell(nx, ny) !== 'wall') actions.push({ action: 'move', dir });
    }
    if (this.getItemAt(x, y)) actions.push({ action: 'pickup' });
    if (this.getCell(x, y) === 'exit') actions.push({ action: 'descend' });
    for (const item of this.player.inventory) {
      if (ITEM_DEFS[item]?.usable)    actions.push({ action: 'use_item', item });
      if (ITEM_DEFS[item]?.equipable) actions.push({ action: 'equip', item });
    }
    return actions;
  }

  // What the AI sees — no internal formulas, no map coords
  getAIState() {
    return {
      floor: this.floorNum,
      score: this.score,
      gameOver: this.gameOver,
      player: {
        hp: this.player.hp,
        maxHp: this.player.maxHp,
        inventory: [...this.player.inventory],
        weapon: this.player.weapon,
        armor: this.player.armor,
        gold: this.player.gold,
      },
      currentCell: this.getCell(this.player.x, this.player.y),
      surroundings: this.getSurroundings(),
      availableActions: this.getAvailableActions(),
      recentLog: this.log.slice(-6),
    };
  }

  // Full state for web visualization
  getFullState() {
    const ai = this.getAIState();
    return {
      ...ai,
      player: { ...ai.player, x: this.player.x, y: this.player.y },
      map: this.map,
      entities: this.entities,
      items: this.items,
      fullLog: this.log,
    };
  }
}

module.exports = { GameEngine };
