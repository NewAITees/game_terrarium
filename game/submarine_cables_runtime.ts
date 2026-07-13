import type { SubmarineSummaryState } from '../shared/types/submarine';

const ENDPOINTS = {
  cables: 'https://www.submarinecablemap.com/api/v3/cable/all.json',
  landings: 'https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json',
  routes: 'https://www.submarinecablemap.com/api/v3/cable/cable-geo.json',
} as const;

type CacheEntry = {
  updatedAt: number;
  state: SubmarineSummaryState | null;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export class SubmarineCablesRuntime {
  private cache: CacheEntry = { updatedAt: 0, state: null };

  async getSnapshot(): Promise<SubmarineSummaryState> {
    if (!this.cache.state || Date.now() - this.cache.updatedAt > 5 * 60 * 1000) {
      this.cache = { updatedAt: Date.now(), state: await this.refresh() };
    }
    return this.cache.state;
  }

  private async refresh(): Promise<SubmarineSummaryState> {
    const [cables, landings, routes] = await Promise.all([
      this.fetchJson(ENDPOINTS.cables),
      this.fetchJson(ENDPOINTS.landings),
      this.fetchJson(ENDPOINTS.routes),
    ]);
    const safeCables = Array.isArray(cables) ? cables : [];
    const safeLandings = Array.isArray(landings?.features) ? landings.features : [];
    const safeRoutes = Array.isArray(routes?.features) ? routes.features : [];
    const countryCounts = new Map<string, number>();
    for (const feature of safeLandings) {
      const name = String(feature?.properties?.name || '');
      const parts = name.split(',').map((part: string) => part.trim()).filter(Boolean);
      const country = parts.length > 1 ? parts[parts.length - 1] : '';
      if (!country) continue;
      countryCounts.set(country, (countryCounts.get(country) || 0) + 1);
    }
    const topCableNames = safeCables.slice(0, 10).map((entry: any) => entry.name || entry.id || 'unknown');
    const topCountries = [...countryCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([country, landingsCount]) => ({ country, landings: landingsCount }));
    const landingCount = safeLandings.length;
    const routeCount = safeRoutes.length;
    const cableCount = safeCables.length;
    const countryCount = countryCounts.size;
    const routeDensity = routeCount / Math.max(1, cableCount);
    const landingDensity = landingCount / Math.max(1, countryCount);
    const topCountryShare = topCountries.length ? topCountries[0].landings / Math.max(1, landingCount) : 0;
    const spread = clamp01(countryCount / 55);
    const balance = clamp01(1 - Math.abs(routeDensity - 0.9) / 0.9);
    const health = clamp01((spread + balance) / 2);
    const pressure = clamp01(routeDensity / 1.5);
    const momentum = clamp01(average([routeDensity / 1.2, landingDensity / 18, topCableNames.length / 10]));
    const activity = clamp01((routeCount + landingCount) / Math.max(1, cableCount * 2));
    const risk = clamp01(1 - health + topCountryShare * 0.2);
    const fun = clamp01(0.2 + spread * 0.35 + balance * 0.35 + activity * 0.2);
    return {
      page: 'submarine_cables',
      updatedAt: new Date().toISOString(),
      cableCount,
      landingCount,
      routeCount,
      countryCount,
      topCableNames,
      topCountries,
      analysis: {
        phase: 'catalog_view',
        progress: clamp01(cableCount / 600),
        health,
        stability: balance,
        pressure,
        momentum,
        activity,
        risk,
        fun,
        summary: `${cableCount} cables, ${landingCount} landings, ${routeCount} routes across ${countryCount} countries`,
        signals: [
          { key: 'countryCount', value: countryCount, target: 40, weight: 1 },
          { key: 'routeDensity', value: routeDensity, target: 1, weight: 0.8 },
          { key: 'topCountryShare', value: topCountryShare, target: 0.12, weight: 0.6 },
        ],
        highlights: topCountries.map((entry) => `${entry.country}:${entry.landings}`),
        details: {
          cableCount,
          landingCount,
          routeCount,
          countryCount,
          routeDensity: Number(routeDensity.toFixed(3)),
          landingDensity: Number(landingDensity.toFixed(3)),
          topCountryShare: Number(topCountryShare.toFixed(3)),
        },
      },
    } as any;
  }

  private async fetchJson(url: string): Promise<any> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`failed to fetch submarine data: ${url} (${response.status})`);
    return response.json();
  }
}
