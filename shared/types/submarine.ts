export type SubmarineSummaryState = {
  page: 'submarine_cables' | 'submarine_network_3d';
  updatedAt: string;
  cableCount?: number;
  routeCount?: number;
  landingCount?: number;
  countryCount?: number;
  topCableNames?: string[];
  topCountries?: Array<{ country: string; landings: number }>;
};
