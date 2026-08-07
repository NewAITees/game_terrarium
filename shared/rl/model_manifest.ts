export type ModelEvaluationMetrics = {
  episodes: number;
  values: Record<string, number>;
};

export type ModelManifest = {
  version: 1;
  gameId: string;
  algorithm: string;
  modelVersion: number;
  observationSchemaVersion: number;
  rewardSchemaVersion: number;
  revision: number;
  trainingSteps: number;
  publishedAt: string;
  evaluation?: ModelEvaluationMetrics;
  checksum?: string;
};

export type ModelSnapshot<Model> = {
  manifest: ModelManifest;
  model: Model;
};

export type ModelCompatibility = Pick<
  ModelManifest,
  'gameId' | 'algorithm' | 'modelVersion' | 'observationSchemaVersion' | 'rewardSchemaVersion'
>;

export function isCompatibleModelManifest(
  value: unknown,
  expected: ModelCompatibility,
): value is ModelManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<ModelManifest>;
  return manifest.version === 1
    && manifest.gameId === expected.gameId
    && manifest.algorithm === expected.algorithm
    && manifest.modelVersion === expected.modelVersion
    && manifest.observationSchemaVersion === expected.observationSchemaVersion
    && manifest.rewardSchemaVersion === expected.rewardSchemaVersion
    && Number.isInteger(manifest.revision)
    && Number(manifest.revision) >= 0
    && Number.isFinite(manifest.trainingSteps)
    && Number(manifest.trainingSteps) >= 0
    && typeof manifest.publishedAt === 'string'
    && Number.isFinite(Date.parse(manifest.publishedAt));
}

export function createModelManifest(
  compatibility: ModelCompatibility,
  values: {
    revision: number;
    trainingSteps: number;
    publishedAt?: string;
    evaluation?: ModelEvaluationMetrics;
    checksum?: string;
  },
): ModelManifest {
  return {
    version: 1,
    ...compatibility,
    revision: Math.max(0, Math.floor(values.revision)),
    trainingSteps: Math.max(0, Math.floor(values.trainingSteps)),
    publishedAt: values.publishedAt ?? new Date().toISOString(),
    evaluation: values.evaluation,
    checksum: values.checksum,
  };
}
