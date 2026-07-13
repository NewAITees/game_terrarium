export type PlanetStrategyPlanetType = 'neutral' | 'mine' | 'factory';
export type PlanetStrategyShipKind = 'transport' | 'attacker' | 'defender' | 'gunship';
export type PlanetStrategyShipStatus =
  | 'docked'
  | 'launching'
  | 'orbiting'
  | 'traveling'
  | 'approaching'
  | 'engaging';
export type PlanetStrategyLogType = 'info' | 'warning' | 'resource' | 'empire' | string;
export type PlanetStrategyInterventionType = 'resource_burst' | 'panic_repair';
export type PlanetStrategyConstructionType = 'mine' | 'factory';
export type PlanetStrategyPersonality = 'industrialist' | 'raider' | 'expansionist' | 'fortifier';
export type PlanetStrategyAiGoal = 'expand' | 'pressure' | 'stabilize';

export interface PlanetStrategyPosition {
  x: number;
  y: number;
  z: number;
}

export interface PlanetStrategyPlanetStructures {
  mine: number;
  factory: number;
  turret: number;
}

export interface PlanetStrategyPlanet extends PlanetStrategyPosition {
  id: string;
  label: string;
  resources: number;
  maxResources: number;
  mineRate: number;
  owner: number;
  stock: number;
  type: PlanetStrategyPlanetType;
  structures: PlanetStrategyPlanetStructures;
  factoryHp: number;
  underConstruction: PlanetStrategyConstruction | null;
  productionQueue: number;
  trafficIn: number;
  stalled: boolean;
  collapseTimer?: number;
  mesh?: any | null;
  ring?: any | null;
  labelGlow?: any | null;
  oreRing?: any | null;
  ownershipRing?: any | null;
  alertRing?: any | null;
  homeAura?: any | null;
  roleGlow?: any | null;
  factoryIcon?: any | null;
  factoryLight?: any | null;
  factoryLightGroup?: any | null;
  turretAsset?: any | null;
  structureAsset?: any | null;
  labelSprite?: any | null;
  labelText?: string;
  decorRing?: any | null;
  decorRings?: any[];
}

export interface PlanetStrategyEmpire {
  id: number;
  name: string;
  color: string;
  personality: PlanetStrategyPersonality;
  summary: string;
  intent: string;
  mined: number;
  delivered: number;
  producedShips: number;
  stalledTime: number;
  collapsed: boolean;
  collapseReason: string | null;
  homeMineId: string;
  homeFactoryId: string;
  shipCap: number;
  goal: PlanetStrategyAiGoal;
  attackTargetLabel?: string | null;
  attackUntil?: number;
}

export interface PlanetStrategyShip {
  id: string;
  kind: PlanetStrategyShipKind;
  owner: number;
  fromPlanetId: string;
  toPlanetId: string;
  homePlanetId: string;
  targetPlanetId: string | null;
  position: PlanetStrategyPosition;
  progress: number;
  speed: number;
  cargo: number;
  capacity: number;
  status: PlanetStrategyShipStatus;
  hp: number;
  maxHp: number;
  physAttack: number;
  laserAttack: number;
  physDef: number;
  heatDef: number;
  attack: number;
  defense: number;
  orbitAngle: number;
  orbitRadius: number;
  orbitSpeed: number;
  launchTimer: number;
  fireCooldown: number;
  mesh?: any | null;
  trailPoints?: unknown[];
  trailLine?: any | null;
}

export interface PlanetStrategyMissile extends PlanetStrategyPosition {
  id: string;
  owner: number;
  sourceShipId: string | null;
  sourcePlanetId: string | null;
  targetShipId: string | null;
  targetPlanetId: string | null;
  weaponKind?: PlanetStrategyShipKind;
  speed: number;
  hp: number;
  maxHp: number;
  physAttack: number;
  laserAttack: number;
  physDef: number;
  heatDef: number;
  life: number;
  mesh?: any | null;
  trailLine?: any | null;
}

export interface PlanetStrategyRoute {
  fromPlanetId: string;
  toPlanetId: string;
  traffic: number;
  hostileTimer?: number;
  line?: any | null;
  glow?: any | null;
  curve?: any | null;
}

export interface PlanetStrategyConstruction {
  empireId: number;
  type: PlanetStrategyConstructionType;
  progress: number;
  needed: number;
}

export interface PlanetStrategyScoreEntry {
  id: number;
  name: string;
  total: number;
  collapsed: boolean;
  deliveredScore?: number;
  producedScore?: number;
  planetScore?: number;
  survivalBonus?: number;
}

export interface PlanetStrategyWorld {
  time: number;
  planets: PlanetStrategyPlanet[];
  empires: PlanetStrategyEmpire[];
  ships: PlanetStrategyShip[];
  missiles: PlanetStrategyMissile[];
  routes: Map<string, PlanetStrategyRoute>;
  routeStats: unknown[];
  minedTotal: number;
  deliveredTotal: number;
  logCooldowns: Map<string, number>;
  shipSerial: number;
  missileSerial: number;
  kills: number;
  gameOver: boolean;
  endReason: string | null;
  winnerId: number | null;
  finalSummary: string;
  finalDetail: string;
  finalScores: PlanetStrategyScoreEntry[];
  oreFalloffStart: number | null;
}

export interface PlanetStrategyAiContext {
  world: PlanetStrategyWorld;
  getPlanet: (id: string | null | undefined) => PlanetStrategyPlanet | undefined;
  distance3d: (a: PlanetStrategyPosition, b: PlanetStrategyPosition) => number;
  rng: () => number;
  queueConstruction: (
    empire: PlanetStrategyEmpire,
    planet: PlanetStrategyPlanet,
    type: PlanetStrategyConstructionType
  ) => void;
  maybeLog: (key: string, text: string, type: PlanetStrategyLogType, cooldownSec?: number) => void;
}

export type PlanetStrategyAiStrategy = (
  empire: PlanetStrategyEmpire,
  ctx: PlanetStrategyAiContext
) => void;

export interface PlanetStrategyRendererDeps {
  world: PlanetStrategyWorld;
  rng: () => number;
  getPlanet: (id: string) => PlanetStrategyPlanet | undefined;
  distance3d: (a: PlanetStrategyPosition, b: PlanetStrategyPosition) => number;
  routeKey: (a: string, b: string) => string;
}

export interface PlanetStrategyRenderer {
  attachMissileMesh: (missile: PlanetStrategyMissile) => void;
  attachShipMesh: (ship: PlanetStrategyShip, empire: PlanetStrategyEmpire) => void;
  ensureRouteVisual: (route: PlanetStrategyRoute) => void;
  removeMissileMesh: (missile: PlanetStrategyMissile) => void;
  removeShipMesh: (ship: PlanetStrategyShip) => void;
  triggerPlanetFlash: (planet: PlanetStrategyPlanet, kind?: 'damage' | 'destroyed') => void;
  triggerMissileHit: (position: PlanetStrategyPosition, colorValue?: string) => void;
  triggerShipFlash: (ship: PlanetStrategyShip) => void;
  renderFrame: () => void;
  updateVisuals: (dt?: number) => void;
  onResize: () => void;
}

export interface PlanetStrategyHudScoreRow {
  name: string;
  collapsed: boolean;
  value: number;
}

export interface PlanetStrategyHudEmpireRow {
  color: string;
  name: string;
  intent: string;
  numbers: string;
}

export interface PlanetStrategyHudView {
  elapsed?: number;
  planets?: number;
  ships?: number;
  mined?: number;
  moved?: number;
  depleted?: number;
  kills?: number | string;
  summaryText?: string;
  summaryDetail?: string;
  busiestRoute?: string;
  busiestRouteLabel?: string | null;
  phaseLine?: string;
  winnerLine?: string;
  statusDetail?: string;
  gameOver?: boolean;
  winnerName?: string | null;
  topDeliveryEmpire?: string | null;
  depletedCount?: number;
  scoreRows?: PlanetStrategyHudScoreRow[];
  empireRows?: PlanetStrategyHudEmpireRow[];
}

export interface PlanetStrategyUi {
  update: (view: PlanetStrategyHudView) => void;
  log: (text: string, type: PlanetStrategyLogType) => void;
}

export interface PlanetStrategyTelemetryEmpire {
  id: number;
  name: string;
  personality: string;
  planets: number;
  stock: number;
  transports: number;
  intent: string;
}

export interface PlanetStrategyTelemetryScoreBreakdown {
  deliveredScore: number;
  producedScore: number;
  planetScore: number;
  survivalBonus: number;
}

export interface PlanetStrategyTelemetryScore {
  id: number;
  name: string;
  total: number;
  collapsed: boolean;
  breakdown?: PlanetStrategyTelemetryScoreBreakdown;
}

export interface PlanetStrategyTelemetryPayload {
  elapsed: number;
  matchEndSeconds: number;
  matchForceEndSeconds: number;
  planets: number;
  ships: number;
  minedTotal: number;
  deliveredTotal: number;
  depletedPlanets: number;
  gameOver: boolean;
  endReason: string | null;
  winnerId: number | null;
  empires: PlanetStrategyTelemetryEmpire[];
  scores: PlanetStrategyTelemetryScore[];
  finalScores?: PlanetStrategyTelemetryScore[];
  [key: string]: unknown;
}
