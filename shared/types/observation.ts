export type ObservationSignal = {
  key: string;
  value: number;
  target?: number;
  lower?: number;
  upper?: number;
  weight?: number;
};

export type ObservationAnalysis = {
  phase: string;
  progress: number;
  health: number;
  stability: number;
  pressure: number;
  momentum: number;
  activity: number;
  risk: number;
  fun: number;
  summary: string;
  signals: ObservationSignal[];
  highlights: string[];
  details: Record<string, number | string | boolean>;
};
