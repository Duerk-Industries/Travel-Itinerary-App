import { createHash } from 'crypto';
import type { AiExperiment, AiExperimentVariant } from '../../types';

const bucketFor = (assignmentKey: string, experimentId: string): number => {
  const hash = createHash('sha256').update(`${assignmentKey}:${experimentId}`).digest();
  return hash.readUInt32BE(0) % 100;
};

export const resolveExperimentVariant = (
  assignmentKey: string,
  experiment: Pick<AiExperiment, 'experimentId' | 'variants' | 'controlVariantId'>,
): AiExperimentVariant => {
  const variants = experiment.variants ?? [];
  if (!variants.length) {
    throw new Error(`Experiment has no variants: ${experiment.experimentId}`);
  }
  const control = variants.find((variant) => variant.variantId === experiment.controlVariantId) ?? variants[0];
  const bucket = bucketFor(assignmentKey, experiment.experimentId);
  let cursor = 0;
  for (const variant of variants) {
    const width = Math.max(0, Math.min(100, Number(variant.trafficPercent ?? 0)));
    if (bucket >= cursor && bucket < cursor + width) return variant;
    cursor += width;
  }
  return control;
};

export const __bucketForExperimentTests = bucketFor;
