import type { FieldEvaluatorResult } from './fieldEvaluator';

export type EvaluationResult = {
  evaluationSchemaVersion: 1;
  captureId: string;
  featureKey: 'parsing';
  evaluatedAt: string;
  itemResults: FieldEvaluatorResult[];
  scores: {
    parseQualityScore: number;
    completenessScore: number;
    validationScore: number;
  };
};

const pct = (numerator: number, denominator: number): number =>
  denominator <= 0 ? 100 : Math.round((numerator / denominator) * 100);

export const scoreEvaluation = (captureId: string, itemResults: FieldEvaluatorResult[]): EvaluationResult => {
  const allFields = itemResults.flatMap((item) => item.fields);
  const expectedFields = allFields.filter((field) => field.required || field.typicallyPresent);
  const presentExpected = expectedFields.filter((field) => field.present).length;
  const formatChecked = allFields.filter((field) => field.formatValid !== null);
  const formatValid = formatChecked.filter((field) => field.formatValid === true).length;
  const crossChecks = itemResults.flatMap((item) => item.crossFieldChecks);
  const crossValid = crossChecks.filter((check) => check.passed).length;
  const validationNumerator = formatValid + crossValid;
  const validationDenominator = formatChecked.length + crossChecks.length;
  const completenessScore = pct(presentExpected, expectedFields.length);
  const validationScore = pct(validationNumerator, validationDenominator);

  return {
    evaluationSchemaVersion: 1,
    captureId,
    featureKey: 'parsing',
    evaluatedAt: new Date().toISOString(),
    itemResults,
    scores: {
      parseQualityScore: Math.round((completenessScore + validationScore) / 2),
      completenessScore,
      validationScore,
    },
  };
};
