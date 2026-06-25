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
      cars: this.cars.map((car) => ({ ...car })),
    };
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
      const sign = this.headingSign(car.heading);
      const inter = this.nextInter(car);
      let speed = car.speedNow;

      if (inter) {
        const iPos = this.axisCoord(inter, car.heading);
        const hw = CONFIG.roadW / 2;
        const stopLine = iPos - sign * (hw + CONFIG.stopGap);
        const front = car.pos + sign * (CONFIG.carLen / 2);
        const approaching = sign > 0
          ? (front >= stopLine - 0.28 && car.pos < iPos)
          : (front <= stopLine + 0.28 && car.pos > iPos);

        if (approaching && !this.canGoHeading(car.heading, inter.state)) {
          speed = 0;
          const clampedCenter = stopLine - sign * (CONFIG.carLen / 2);
          if (sign > 0) car.pos = Math.min(car.pos, clampedCenter);
          else car.pos = Math.max(car.pos, clampedCenter);
        }
      }

      const prevPos = car.pos;
      car.pos += sign * speed * dt;

      if (inter) {
        const iPos = this.axisCoord(inter, car.heading);
        const crossed = sign > 0 ? (prevPos < iPos && car.pos >= iPos) : (prevPos > iPos && car.pos <= iPos);
        if (crossed) {
          const nextHeading = this.chooseHeadingAtIntersection(car, inter);
          this.applyTurn(car, inter, nextHeading);
        }
      }

      const limit = CONFIG.half + 2;
      if (car.pos > limit) car.pos = -limit;
      if (car.pos < -limit) car.pos = limit;
    }
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

  private applyTurn(car: RuntimeCar, inter: RuntimeIntersection, nextHeading: CityTrafficHeading): void {
    if (nextHeading === car.heading) return;
    car.heading = nextHeading;
    if (this.isEWHeading(nextHeading)) {
      car.roadIndex = inter.zi;
      car.pos = inter.x;
    } else {
      car.roadIndex = inter.xi;
      car.pos = inter.z;
    }
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
