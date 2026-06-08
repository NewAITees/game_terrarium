import { generateFloor, initializePlayer, randomFloorPos } from './engine_floor.js';
import {
  calcPlayerDamage,
  calcPlayerDefense,
  doAttack,
  doDescend,
  doEquip,
  doMove,
  doPickup,
  doUseItem,
  getAIState,
  getCell,
  getFullState,
  getItemAt,
  getMonsterAt,
  getSurroundings,
  monsterTurns,
  moveMonsterToward,
  processAction,
  getAvailableActions,
} from './engine_runtime.js';
import type { Item, MapState, Monster, Player } from './engine_types.js';

export class GameEngine {
  floorNum = 1;
  score = 0;
  gameOver = false;
  log: string[] = [];
  player!: Player;
  map!: MapState;
  entities: Monster[] = [];
  items: Item[] = [];

  constructor() {
    this.reset();
  }

  reset(): void {
    this.floorNum = 1;
    this.score = 0;
    this.gameOver = false;
    this.log = [];
    this.player = initializePlayer();
    this.generateFloor();
  }

  addLog(msg: string): void {
    this.log.push(msg);
    if (this.log.length > 100) this.log.shift();
  }

  generateFloor(): void {
    generateFloor(this);
  }

  randomFloorPos(minDist = 0): { x: number; y: number } | null {
    return randomFloorPos(this, minDist);
  }

  getCell(x: number, y: number): string {
    return getCell(this, x, y);
  }

  getMonsterAt(x: number, y: number): Monster | null {
    return getMonsterAt(this, x, y);
  }

  getItemAt(x: number, y: number): Item | null {
    return getItemAt(this, x, y);
  }

  calcPlayerDamage(): number {
    return calcPlayerDamage(this);
  }

  calcPlayerDefense(): number {
    return calcPlayerDefense(this);
  }

  processAction(action: string, params: Record<string, any> = {}): Record<string, any> {
    return processAction(this, action, params);
  }

  doMove(dir: any): Record<string, any> {
    return doMove(this, dir);
  }

  doAttack(dir: any): Record<string, any> {
    return doAttack(this, dir);
  }

  monsterTurns(): Record<string, any> {
    return monsterTurns(this);
  }

  moveMonsterToward(monster: Monster): void {
    moveMonsterToward(this, monster);
  }

  doPickup(): Record<string, any> {
    return doPickup(this);
  }

  doUseItem(itemType: any): Record<string, any> {
    return doUseItem(this, itemType);
  }

  doEquip(itemType: any): Record<string, any> {
    return doEquip(this, itemType);
  }

  doDescend(): Record<string, any> {
    return doDescend(this);
  }

  getSurroundings(): Record<string, string> {
    return getSurroundings(this);
  }

  getAvailableActions(): Array<Record<string, string>> {
    return getAvailableActions(this);
  }

  getAIState(): Record<string, any> {
    return getAIState(this);
  }

  getFullState(): Record<string, any> {
    return getFullState(this);
  }
}
