export type GroundTruthSignal = 'admin_review' | 'golden_fixture' | 'none';

export type GroundTruthInput = {
  adminReview?: { agreement: number } | null;
  goldenFixture?: { agreement: number } | null;
};

export const resolveGroundTruthSignal = (input: GroundTruthInput): {
  signal: GroundTruthSignal;
  agreement: number | null;
} => {
  if (input.adminReview) return { signal: 'admin_review', agreement: input.adminReview.agreement };
  if (input.goldenFixture) return { signal: 'golden_fixture', agreement: input.goldenFixture.agreement };
  return { signal: 'none', agreement: null };
};
