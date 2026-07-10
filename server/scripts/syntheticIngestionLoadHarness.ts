import { initDb, listAiExperiments } from '../src/db';
import { resolveExperimentVariant } from '../src/ai/experiments/assignment';
import { recordExperimentVariantOutcome } from '../src/ai/experiments/circuitBreaker';

const getArg = (name: string, fallback?: string): string | undefined => {
  const inline = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const main = async () => {
  if (hasFlag('help')) {
    console.log('Usage: tsx server/scripts/syntheticIngestionLoadHarness.ts --experiment-id <id> [--requests 100] [--failure-rate 0.3]');
    return;
  }
  await initDb();
  const experimentId = getArg('experiment-id');
  const requests = Math.max(1, Number(getArg('requests', '100')));
  const failureRate = Math.max(0, Math.min(1, Number(getArg('failure-rate', '0'))));
  const experiments = await listAiExperiments({ status: 'running', limit: 500 });
  const experiment = experiments.find((item) => !experimentId || item.experimentId === experimentId);
  if (!experiment) throw new Error('No running experiment found');
  const controlVariantId = experiment.controlVariantId ?? experiment.variants[0]?.variantId;
  if (!controlVariantId) throw new Error('Experiment has no control variant');

  let sampled = 0;
  let failed = 0;
  for (let index = 0; index < requests; index += 1) {
    const variant = resolveExperimentVariant(`synthetic-${index}`, experiment);
    if (variant.variantId === controlVariantId) continue;
    sampled += 1;
    const success = Math.random() >= failureRate;
    if (!success) failed += 1;
    await recordExperimentVariantOutcome({
      experimentId: experiment.experimentId,
      variantId: variant.variantId,
      controlVariantId,
      success,
    });
  }
  console.log(JSON.stringify({
    experimentId: experiment.experimentId,
    requests,
    sampled,
    failed,
    failureRate,
  }, null, 2));
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
