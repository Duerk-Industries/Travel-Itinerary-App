/**
 * Shared traffic-sampling helper for admin-configurable "percent of requests" runtime settings
 * (e.g. `shadow_parse_sample_rate_percent`, `parser_consensus_sample_rate_percent`). A single
 * implementation keeps the sampling semantics — clamped range, inclusive/exclusive boundary —
 * identical everywhere it's used instead of drifting between call sites.
 */
export const shouldSample = (sampleRatePercent: number, randomValue = Math.random()): boolean => {
  const rate = Math.max(0, Math.min(100, sampleRatePercent));
  return randomValue * 100 < rate;
};
