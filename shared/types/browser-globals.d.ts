interface TelemetryClient {
  report(page: string, payload: unknown, minIntervalMs?: number): void;
}

interface Window {
  Telemetry?: TelemetryClient;
  __planetStrategy?: {
    world: unknown;
    computeVictoryScores: () => unknown;
    finalizeMatch: (reason: string) => void;
  };
}
