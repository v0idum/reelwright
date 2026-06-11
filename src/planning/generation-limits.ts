const DEFAULT_MAX_GENERATION_DURATION_SECONDS = 30;

const MODEL_MAX_GENERATION_DURATION_SECONDS: Record<string, number> = {
  kling3_0: 15,
  seedance_2_0: 15
};

export function maxGenerationDurationSeconds(model: string): number {
  return MODEL_MAX_GENERATION_DURATION_SECONDS[model] ?? DEFAULT_MAX_GENERATION_DURATION_SECONDS;
}
