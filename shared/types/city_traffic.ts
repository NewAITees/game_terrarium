export type CityTrafficHeading = 'E' | 'W' | 'S' | 'N';

export type CityTrafficSignalState = 0 | 1 | 2 | 3;

export type CityTrafficConfig = {
  half: number;
  block: number;
  roadW: number;
  laneOff: number;
  carLen: number;
  stopGap: number;
  carCount: number;
  speedMin: number;
  speedMax: number;
  gTime: number;
  yTime: number;
  followGapMin: number;
  followGapSoft: number;
};

export type CityTrafficCarSnapshot = {
  id: number;
  heading: CityTrafficHeading;
  roadIndex: number;
  pos: number;
  baseSpeed: number;
  speedNow: number;
  targetXi: number;
  targetZi: number;
  vehicleKey: string;
};

export type CityTrafficIntersectionSnapshot = {
  id: string;
  x: number;
  z: number;
  xi: number;
  zi: number;
  state: CityTrafficSignalState;
  timer: number;
};

export type CityTrafficStateSnapshot = {
  page: 'city_traffic';
  seed: number;
  elapsed: number;
  config: CityTrafficConfig;
  roads: number[];
  intersections: CityTrafficIntersectionSnapshot[];
  cars: CityTrafficCarSnapshot[];
};
