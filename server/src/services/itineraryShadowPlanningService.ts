import { createHash } from 'node:crypto';

export const shouldRunItineraryShadow = (seed: string, samplePercent = 5): boolean => {
  const bucket = parseInt(createHash('sha256').update(String(seed)).digest('hex').slice(0, 8), 16) % 100;
  return bucket < Math.max(0, Math.min(100, samplePercent));
};

export type ShadowJudgeResult = { winner: 'legacy' | 'improved' | 'tie'; transitRealism: number; preferenceAlignment: number; rationale: string };
export type ShadowJudge = (input: { legacy: unknown; improved: unknown }) => Promise<ShadowJudgeResult>;

export const runShadowComparison = async (params: { seed: string; legacy: unknown; improved: unknown; judge: ShadowJudge; samplePercent?: number }): Promise<ShadowJudgeResult | null> =>
  shouldRunItineraryShadow(params.seed, params.samplePercent ?? 5)
    ? params.judge({ legacy: params.legacy, improved: params.improved })
    : null;

