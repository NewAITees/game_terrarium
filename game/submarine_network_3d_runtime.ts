import type { SubmarineSummaryState } from '../shared/types/submarine';

const ENDPOINTS = {
  landings: 'https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json',
  routes: 'https://www.submarinecablemap.com/api/v3/cable/cable-geo.json',
} as const;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export class SubmarineNetwork3DRuntime {
  private cache: { updatedAt: number; state: SubmarineSummaryState | null } = { updatedAt: 0, state: null };

  async getSnapshot(): Promise<SubmarineSummaryState> {
    if (!this.cache.state || Date.now() - this.cache.updatedAt > 5 * 60 * 1000) {
      this.cache = { updatedAt: Date.now(), state: await this.refresh() };
    }
    return this.cache.state;
  }

  private async refresh(): Promise<SubmarineSummaryState> {
    const [landings, routes] = await Promise.all([
      this.fetchJson(ENDPOINTS.landings),
      this.fetchJson(ENDPOINTS.routes),
    ]);
    const safeLandings = Array.isArray(landings?.features) ? landings.features : [];
    const safeRoutes = Array.isArray(routes?.features) ? routes.features : [];
    const countries = new Map<string, number>();
    for (const feature of safeLandings) {
      const name = String(feature?.properties?.name || '');
      const parts = name.split(',').map((part: string) => part.trim()).filter(Boolean);
      const country = parts.length > 1 ? parts[parts.length - 1] : '';
      if (!country) continue;
      countries.set(country, (countries.get(country) || 0) + 1);
    }
    const topCountries = [...countries.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([country, landingsCount]) => ({ country, landings: landingsCount }));
    const landingCount = safeLandings.length;
    const routeCount = safeRoutes.length;
    const countryCount = countries.size;
    const countryConcentration = topCountries.length ? topCountries[0].landings / Math.max(1, landingCount) : 0;
    const graphDensity = routeCount / Math.max(1, landingCount * 1.5);
    const balance = clamp01(1 - Math.abs(graphDensity - 0.25) / 0.25);
    const spread = clamp01(countryCount / 55);
    const health = clamp01((balance + spread) / 2);
    const pressure = clamp01(countryConcentration * 0.9 + graphDensity * 0.4);
    const momentum = clamp01(average([graphDensity / 0.4, spread, topCountries.length / 10]));
    const activity = clamp01((routeCount + landingCount) / Math.max(1, 2200));
    const risk = clamp01(1 - health + countryConcentration * 0.15);
    const fun = clamp01(0.2 + spread * 0.35 + balance * 0.3 + activity * 0.15 + topCountries.length / 50);
    return {
      page: 'submarine_network_3d',
      updatedAt: new Date().toISOString(),
      landingCount,
      routeCount,
      countryCount,
      topCountries,
      analysis: {
        phase: 'graph_view',
        progress: clamp01(landingCount / 2000),
        health,
        stability: balance,
        pressure,
        momentum,
        activity,
        risk,
        fun,
        summary: `${landingCount} landings, ${routeCount} routes, ${countryCount} countries`,
        signals: [
          { key: 'countryCount', value: countryCount, target: 40, weight: 1 },
          { key: 'graphDensity', value: graphDensity, target: 0.25, weight: 0.9 },
          { key: 'countryConcentration', value: countryConcentration, target: 0.12, weight: 0.7 },
        ],
        highlights: topCountries.map((entry) => `${entry.country}:${entry.landings}`),
        details: {
          landingCount,
          routeCount,
          countryCount,
          graphDensity: Number(graphDensity.toFixed(3)),
          countryConcentration: Number(countryConcentration.toFixed(3)),
          topCountryShare: Number(countryConcentration.toFixed(3)),
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
