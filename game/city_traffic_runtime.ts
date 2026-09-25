import { RNG } from '../shared/network-core-topology';
import type {
  CityTrafficCarSnapshot,
  CityTrafficConfig,
  CityTrafficHeading,
  CityTrafficIntersectionSnapshot,
  CityTrafficSignalState,
  CityTrafficStateSnapshot,
} from '../shared/types/city_traffic';

const CONFIG: CityTrafficConfig = {
  half: 48,
  block: 16,
  roadW: 3.2,
  laneOff: 0.72,
  carLen: 2.2,
  stopGap: 0.55,
  carCount: 42,
  speedMin: 3.0,
  speedMax: 7.5,
  gTime: 4.5,
  yTime: 0.9,
  followGapMin: 2.8,
  followGapSoft: 8.0,
};

// Corner turn radius. Must stay below (roadW/2 + stopGap - laneOff) so a car committed to a
// turn never starts curving before it would have had to stop for a red light at the old
// straight-line stop line: 1.6 + 0.55 - 0.72 = 1.43.
const TURN_RADIUS = 1.3;

const DURS = [CONFIG.gTime, CONFIG.yTime, CONFIG.gTime, CONFIG.yTime] as const;
const HEADINGS: CityTrafficHeading[] = ['E', 'W', 'S', 'N'];
const HEADING_VEC: Record<CityTrafficHeading, { x: number; z: number }> = {
  E: { x: 1, z: 0 },
  W: { x: -1, z: 0 },
  S: { x: 0, z: 1 },
  N: { x: 0, z: -1 },
};
const LEFT_TURN: Record<CityTrafficHeading, CityTrafficHeading> = { E: 'N', N: 'W', W: 'S', S: 'E' };
const RIGHT_TURN: Record<CityTrafficHeading, CityTrafficHeading> = { E: 'S', S: 'W', W: 'N', N: 'E' };
// atan2(dir.x, dir.z) for each heading's unit vector, matching the client's rendering convention.
const HEADING_YAW: Record<CityTrafficHeading, number> = { E: Math.PI / 2, W: -Math.PI / 2, S: 0, N: Math.PI };

type TurnArc = {
  ox: number;
  oz: number;
  r: number;
  startAngle: number;
  deltaAngle: number;
  arcLength: number;
  traveled: number;
  exitHeading: CityTrafficHeading;
  newRoadIndex: number;
  newPos: number;
};
const VEHICLE_DEFS = [
  'sedan', 'suv', 'taxi', 'police', 'ambulance', 'van', 'delivery', 'delivery-flat',
  'truck', 'truck-flat', 'garbage-truck', 'firetruck', 'hatchback-sports', 'sedan-sports', 'suv-luxury',
] as const;
const VEHICLE_WEIGHTS: Record<string, number> = {
  sedan: 6, suv: 4, taxi: 3, police: 2, ambulance: 2, van: 4, delivery: 3, 'delivery-flat': 2,
  truck: 2, 'truck-flat': 2, 'garbage-truck': 1, firetruck: 1, 'hatchback-sports': 2, 'sedan-sports': 1, 'suv-luxury': 1,
};

type RuntimeCar = CityTrafficCarSnapshot;
type RuntimeIntersection = CityTrafficIntersectionSnapshot;

export class CityTrafficRuntime {
  private readonly seed: number;
  private readonly rng: RNG;
  private readonly roads: number[];
  private readonly intersections: RuntimeIntersection[] = [];
  private readonly cars: RuntimeCar[] = [];
  private readonly turningCars = new Map<number, TurnArc>();
  private readonly pendingDecision = new Map<number, { interId: string; nextHeading: CityTrafficHeading }>();
  private elapsed = 0;
  private lastTickAt = Date.now();

  constructor(seed?: number) {
    this.seed = seed ?? ((Math.random() * 1e9) | 0);
    this.rng = new RNG(this.seed);
    this.roads = [];
    for (let v = -CONFIG.half; v <= CONFIG.half; v += CONFIG.block) this.roads.push(v);
    this.buildIntersections();
    this.buildCars();
  }

  getSnapshot(): CityTrafficStateSnapshot {
    this.tickToNow();
    return {
      page: 'city_traffic',
      seed: this.seed,
      elapsed: Number(this.elapsed.toFixed(3)),
      config: CONFIG,
      roads: [...this.roads],
      intersections: this.intersections.map((inter) => ({ ...inter })),
      cars: this.cars.map((car) => ({ ...car, ...this.carTransform(car) })),
    };
  }

  private carTransform(car: RuntimeCar): { x: number; z: number; yaw: number } {
    const arc = this.turningCars.get(car.id);
    if (arc) {
      const t = Math.min(arc.traveled / arc.arcLength, 1);
      const angle = arc.startAngle + arc.deltaAngle * t;
      const dirSign = Math.sign(arc.deltaAngle) || 1;
      const dirX = -Math.sin(angle) * dirSign;
      const dirZ = Math.cos(angle) * dirSign;
      return {
        x: arc.ox + arc.r * Math.cos(angle),
        z: arc.oz + arc.r * Math.sin(angle),
        yaw: Math.atan2(dirX, dirZ),
      };
    }
    const laneFixed = this.laneFixed(car.heading, car.roadIndex);
    const isEW = car.heading === 'E' || car.heading === 'W';
    return {
      x: isEW ? car.pos : laneFixed,
      z: isEW ? laneFixed : car.pos,
      yaw: HEADING_YAW[car.heading],
    };
  }

  private laneFixed(heading: CityTrafficHeading, roadIndex: number): number {
    const roadV = this.roads[roadIndex];
    if (heading === 'E') return roadV + CONFIG.laneOff;
    if (heading === 'W') return roadV - CONFIG.laneOff;
    if (heading === 'S') return roadV - CONFIG.laneOff;
    return roadV + CONFIG.laneOff;
  }

  private tickToNow(): void {
    const now = Date.now();
    const dt = Math.min((now - this.lastTickAt) / 1000, 0.05);
    this.lastTickAt = now;
    if (dt > 0) this.tick(dt);
  }

  private buildIntersections(): void {
    const n = this.roads.length;
    for (let xi = 0; xi < n; xi++) {
      for (let zi = 0; zi < n; zi++) {
        this.intersections.push({
          id: `${xi},${zi}`,
          x: this.roads[xi],
          z: this.roads[zi],
          xi,
          zi,
          state: this.rng.int(0, 3) as CityTrafficSignalState,
          timer: this.rng.range(0, DURS[0]),
        });
      }
    }
  }

  private buildCars(): void {
    for (let i = 0; i < CONFIG.carCount; i++) {
      const heading = HEADINGS[this.rng.int(0, HEADINGS.length - 1)];
      const roadIndex = this.rng.int(0, this.roads.length - 1);
      const car: RuntimeCar = {
        id: i,
        heading,
        roadIndex,
        pos: this.rng.range(-CONFIG.half, CONFIG.half),
        baseSpeed: this.rng.range(CONFIG.speedMin, CONFIG.speedMax),
        speedNow: 0,
        targetXi: 0,
        targetZi: 0,
        vehicleKey: this.pickVehicleKey(),
        x: 0,
        z: 0,
        yaw: 0,
      };
      this.assignDestination(car);
      this.cars.push(car);
    }
  }

  private tick(dt: number): void {
    this.elapsed += dt;

    for (const inter of this.intersections) {
      inter.timer += dt;
      if (inter.timer >= DURS[inter.state]) {
        inter.timer -= DURS[inter.state];
        inter.state = ((inter.state + 1) % 4) as CityTrafficSignalState;
      }
    }

    for (const car of this.cars) {
      let minGap = Infinity;
      for (const other of this.cars) {
        if (car.id === other.id) continue;
        const gap = this.laneGapAhead(car, other);
        if (gap < minGap) minGap = gap;
      }
      let speed = car.baseSpeed;
      if (minGap <= CONFIG.followGapMin) {
        speed = 0;
      } else if (minGap < CONFIG.followGapSoft) {
        const t = (minGap - CONFIG.followGapMin) / (CONFIG.followGapSoft - CONFIG.followGapMin);
        speed *= Math.max(0, Math.min(1, t));
      }
      car.speedNow = speed;
    }

    for (const car of this.cars) {
      const arc = this.turningCars.get(car.id);
      if (arc) {
        arc.traveled += car.speedNow * dt;
        if (arc.traveled >= arc.arcLength) {
          car.heading = arc.exitHeading;
          car.roadIndex = arc.newRoadIndex;
          car.pos = arc.newPos;
          this.turningCars.delete(car.id);
        }
        continue;
      }

      const sign = this.headingSign(car.heading);
      const inter = this.nextInter(car);
      let speed = car.speedNow;
      let approaching = false;
      let iPos = 0;

      if (inter) {
        iPos = this.axisCoord(inter, car.heading);
        const hw = CONFIG.roadW / 2;
        const stopLine = iPos - sign * (hw + CONFIG.stopGap);
        const front = car.pos + sign * (CONFIG.carLen / 2);
        approaching = sign > 0
          ? (front >= stopLine - 0.28 && car.pos < iPos)
          : (front <= stopLine + 0.28 && car.pos > iPos);

        if (approaching && !this.canGoHeading(car.heading, inter.state)) {
          speed = 0;
          const clampedCenter = stopLine - sign * (CONFIG.carLen / 2);
          if (sign > 0) car.pos = Math.min(car.pos, clampedCenter);
          else car.pos = Math.max(car.pos, clampedCenter);
        }

        if (approaching && this.pendingDecision.get(car.id)?.interId !== inter.id) {
          const nextHeading = this.chooseHeadingAtIntersection(car, inter);
          this.pendingDecision.set(car.id, { interId: inter.id, nextHeading });
        }
      }

      const prevPos = car.pos;
      car.pos += sign * speed * dt;

      const pending = inter ? this.pendingDecision.get(car.id) : undefined;
      if (inter && pending && pending.interId === inter.id) {
        if (pending.nextHeading === car.heading) {
          const crossed = sign > 0 ? (prevPos < iPos && car.pos >= iPos) : (prevPos > iPos && car.pos <= iPos);
          if (crossed) this.pendingDecision.delete(car.id);
        } else {
          this.startTurn(car, inter, pending.nextHeading, sign, prevPos);
        }
      }

      const limit = CONFIG.half + 2;
      if (car.pos > limit) car.pos = -limit;
      if (car.pos < -limit) car.pos = limit;
    }
  }

  private startTurn(
    car: RuntimeCar,
    inter: RuntimeIntersection,
    nextHeading: CityTrafficHeading,
    sign: number,
    prevPos: number
  ): void {
    const entryHeading = car.heading;
    const entryLaneFixed = this.laneFixed(entryHeading, car.roadIndex);
    const newRoadIndex = this.isEWHeading(nextHeading) ? inter.zi : inter.xi;
    const exitLaneFixed = this.laneFixed(nextHeading, newRoadIndex);
    const triggerPos = exitLaneFixed - sign * TURN_RADIUS;
    const crossed = sign > 0 ? (prevPos < triggerPos && car.pos >= triggerPos) : (prevPos > triggerPos && car.pos <= triggerPos);
    if (!crossed) return;

    const entryDir = HEADING_VEC[entryHeading];
    const exitDir = HEADING_VEC[nextHeading];
    const isEWEntry = this.isEWHeading(entryHeading);
    const cx = isEWEntry ? exitLaneFixed : entryLaneFixed;
    const cz = isEWEntry ? entryLaneFixed : exitLaneFixed;
    const t1x = cx - TURN_RADIUS * entryDir.x;
    const t1z = cz - TURN_RADIUS * entryDir.z;
    const t2x = cx + TURN_RADIUS * exitDir.x;
    const t2z = cz + TURN_RADIUS * exitDir.z;
    const ox = t1x + t2x - cx;
    const oz = t1z + t2z - cz;
    const startAngle = Math.atan2(t1z - oz, t1x - ox);
    const endAngle = Math.atan2(t2z - oz, t2x - ox);
    let deltaAngle = endAngle - startAngle;
    while (deltaAngle <= -Math.PI) deltaAngle += Math.PI * 2;
    while (deltaAngle > Math.PI) deltaAngle -= Math.PI * 2;
    const arcLength = Math.max(TURN_RADIUS * Math.abs(deltaAngle), 0.01);
    const newPos = this.isEWHeading(nextHeading) ? t2x : t2z;

    this.turningCars.set(car.id, {
      ox, oz, r: TURN_RADIUS, startAngle, deltaAngle, arcLength, traveled: 0,
      exitHeading: nextHeading, newRoadIndex, newPos,
    });
    this.pendingDecision.delete(car.id);
  }

  private pickVehicleKey(): string {
    const pool: string[] = [];
    for (const key of VEHICLE_DEFS) {
      for (let i = 0; i < (VEHICLE_WEIGHTS[key] ?? 1); i++) pool.push(key);
    }
    return pool[this.rng.int(0, pool.length - 1)];
  }

  private assignDestination(car: RuntimeCar, avoidXi = -1, avoidZi = -1): void {
    do {
      car.targetXi = this.rng.int(0, this.roads.length - 1);
      car.targetZi = this.rng.int(0, this.roads.length - 1);
    } while (car.targetXi === avoidXi && car.targetZi === avoidZi);
  }

  private nextInter(car: RuntimeCar): RuntimeIntersection | null {
    const n = this.roads.length;
    if (car.heading === 'E') {
      for (let xi = 0; xi < n; xi++) if (this.roads[xi] > car.pos) return this.intersections[xi * n + car.roadIndex];
      return null;
    }
    if (car.heading === 'W') {
      for (let xi = n - 1; xi >= 0; xi--) if (this.roads[xi] < car.pos) return this.intersections[xi * n + car.roadIndex];
      return null;
    }
    if (car.heading === 'S') {
      for (let zi = 0; zi < n; zi++) if (this.roads[zi] > car.pos) return this.intersections[car.roadIndex * n + zi];
      return null;
    }
    for (let zi = n - 1; zi >= 0; zi--) if (this.roads[zi] < car.pos) return this.intersections[car.roadIndex * n + zi];
    return null;
  }

  private chooseHeadingAtIntersection(car: RuntimeCar, inter: RuntimeIntersection): CityTrafficHeading {
    if (inter.xi === car.targetXi && inter.zi === car.targetZi) this.assignDestination(car, inter.xi, inter.zi);

    const options: CityTrafficHeading[] = [car.heading, LEFT_TURN[car.heading], RIGHT_TURN[car.heading]];
    let best = car.heading;
    let bestScore = Infinity;

    for (const nextH of options) {
      const next = this.nextStepIndex(inter.xi, inter.zi, nextH);
      if (next.xi < 0 || next.xi >= this.roads.length || next.zi < 0 || next.zi >= this.roads.length) continue;
      let score = Math.abs(car.targetXi - next.xi) + Math.abs(car.targetZi - next.zi);
      if (nextH !== car.heading) score += 0.08;
      if (score < bestScore) {
        bestScore = score;
        best = nextH;
      }
    }

    if (best === car.heading && this.rng.next() < 0.08) {
      return this.rng.next() < 0.5 ? LEFT_TURN[car.heading] : RIGHT_TURN[car.heading];
    }

    return best;
  }

  private laneGapAhead(car: RuntimeCar, other: RuntimeCar): number {
    if (car.heading !== other.heading || car.roadIndex !== other.roadIndex) return Infinity;
    const loopLen = (CONFIG.half + 2) * 2;
    let gap = this.headingSign(car.heading) > 0 ? other.pos - car.pos : car.pos - other.pos;
    if (gap <= 0) gap += loopLen;
    return gap;
  }

  private canGoHeading(heading: CityTrafficHeading, state: CityTrafficSignalState): boolean {
    return this.isEWHeading(heading) ? (state === 2 || state === 3) : (state === 0 || state === 1);
  }

  private axisCoord(inter: RuntimeIntersection, heading: CityTrafficHeading): number {
    return this.isEWHeading(heading) ? inter.x : inter.z;
  }

  private nextStepIndex(xi: number, zi: number, heading: CityTrafficHeading): { xi: number; zi: number } {
    return { xi: xi + HEADING_VEC[heading].x, zi: zi + HEADING_VEC[heading].z };
  }

  private isEWHeading(heading: CityTrafficHeading): boolean {
    return heading === 'E' || heading === 'W';
  }

  private headingSign(heading: CityTrafficHeading): number {
    return heading === 'E' || heading === 'S' ? 1 : -1;
  }
}
