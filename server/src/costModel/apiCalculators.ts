export type UsageByMetric = Record<string, number>;

export type UsageLevel = {
  metric: string;
  unitCostUsd: number;
  perUnits?: number;
  includedUnits?: number;
};

export type VariableCostSource = {
  id: string;
  api: string;
  usageLevels?: UsageLevel[];
};

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

export const calculateUsageLevelCost = (usage: UsageByMetric, usageLevels: UsageLevel[] = []): number =>
  usageLevels.reduce((sum, level) => {
    const units = Math.max(0, toFiniteNumber(usage[level.metric]) - toFiniteNumber(level.includedUnits));
    const perUnits = Math.max(1, toFiniteNumber(level.perUnits, 1));
    return sum + (units / perUnits) * toFiniteNumber(level.unitCostUsd);
  }, 0);

export type ApiCostCalculator = (source: VariableCostSource, usage: UsageByMetric) => number;

export const calculateOpenAiCost: ApiCostCalculator = (source, usage) =>
  calculateUsageLevelCost(usage, source.usageLevels);

export const calculateGooglePlacesCost: ApiCostCalculator = (source, usage) =>
  calculateUsageLevelCost(usage, source.usageLevels);

export const calculateUnsplashCost: ApiCostCalculator = (source, usage) =>
  calculateUsageLevelCost(usage, source.usageLevels);

export const calculateSmtpCost: ApiCostCalculator = (source, usage) =>
  calculateUsageLevelCost(usage, source.usageLevels);

export const calculateOpenMeteoCost: ApiCostCalculator = (source, usage) =>
  calculateUsageLevelCost(usage, source.usageLevels);

export const calculateFrankfurterCost: ApiCostCalculator = (source, usage) =>
  calculateUsageLevelCost(usage, source.usageLevels);

export const calculateAirportDatasetCost: ApiCostCalculator = (source, usage) =>
  calculateUsageLevelCost(usage, source.usageLevels);

export const calculateGoogleCloudHostingCost: ApiCostCalculator = (source, usage) =>
  calculateUsageLevelCost(usage, source.usageLevels);

export const calculateGmailCost: ApiCostCalculator = (source, usage) =>
  calculateUsageLevelCost(usage, source.usageLevels);

export const calculateMailgunCost: ApiCostCalculator = (source, usage) =>
  calculateUsageLevelCost(usage, source.usageLevels);

export const calculateGoogleAiCost: ApiCostCalculator = (source, usage) =>
  calculateUsageLevelCost(usage, source.usageLevels);

export const calculateDoclingCost: ApiCostCalculator = (source, usage) =>
  calculateUsageLevelCost(usage, source.usageLevels);

export const calculateSerpApiCost: ApiCostCalculator = (source, usage) =>
  calculateUsageLevelCost(usage, source.usageLevels);

export const calculateWikimediaCost: ApiCostCalculator = (source, usage) =>
  calculateUsageLevelCost(usage, source.usageLevels);

const apiCalculators: Record<string, ApiCostCalculator> = {
  airportDataset: calculateAirportDatasetCost,
  docling: calculateDoclingCost,
  frankfurter: calculateFrankfurterCost,
  gmail: calculateGmailCost,
  googleAi: calculateGoogleAiCost,
  googleCloudHosting: calculateGoogleCloudHostingCost,
  googlePlaces: calculateGooglePlacesCost,
  mailgun: calculateMailgunCost,
  openMeteo: calculateOpenMeteoCost,
  openai: calculateOpenAiCost,
  serpApi: calculateSerpApiCost,
  smtp: calculateSmtpCost,
  unsplash: calculateUnsplashCost,
  wikimedia: calculateWikimediaCost,
};

export const getApiCostCalculator = (api: string): ApiCostCalculator =>
  apiCalculators[api] ?? ((source, usage) => calculateUsageLevelCost(usage, source.usageLevels));
