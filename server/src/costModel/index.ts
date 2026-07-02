import fs from 'fs';
import YAML from 'yaml';
import { getApiCostCalculator, type UsageByMetric, type UsageLevel, type VariableCostSource } from './apiCalculators';

export type CostModelSettings = {
  rowStep: number;
  maxUsers: number;
};

export type FixedCostSource = {
  id: string;
  name?: string;
  type: 'fixed';
  monthlyCostUsd: number;
};

export type ConfigVariableCostSource = VariableCostSource & {
  name?: string;
  type: 'variable';
};

export type CostSource = FixedCostSource | ConfigVariableCostSource;

export type CostModelConfig = {
  settings: CostModelSettings;
  userMix: Record<string, number>;
  usagePerUser: Record<string, Record<string, UsageByMetric>>;
  costSources: CostSource[];
};

export type CostModelRow = {
  users: number;
  fixedCostUsd: number;
  variableCostUsd: number;
  totalCostUsd: number;
  sourceCostsUsd: Record<string, number>;
};

const requiredObject = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
};

const toNumber = (value: unknown, path: string): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${path} must be a number`);
  }
  return numeric;
};

const toPositiveInteger = (value: unknown, path: string): number => {
  const numeric = toNumber(value, path);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error(`${path} must be a positive integer`);
  }
  return numeric;
};

const normalizeUsageLevels = (value: unknown, sourceId: string): UsageLevel[] => {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`costSources.${sourceId}.usageLevels must be an array`);
  }
  return value.map((rawLevel, index) => {
    const level = requiredObject(rawLevel, `costSources.${sourceId}.usageLevels.${index}`);
    const metric = String(level.metric ?? '').trim();
    if (!metric) {
      throw new Error(`costSources.${sourceId}.usageLevels.${index}.metric is required`);
    }
    return {
      metric,
      unitCostUsd: toNumber(level.unitCostUsd, `costSources.${sourceId}.usageLevels.${index}.unitCostUsd`),
      perUnits: level.perUnits == null ? 1 : toNumber(level.perUnits, `costSources.${sourceId}.usageLevels.${index}.perUnits`),
      includedUnits:
        level.includedUnits == null
          ? 0
          : toNumber(level.includedUnits, `costSources.${sourceId}.usageLevels.${index}.includedUnits`),
    };
  });
};

const normalizeCostSources = (value: unknown): CostSource[] => {
  if (!Array.isArray(value)) {
    throw new Error('costSources must be an array');
  }
  return value.map((rawSource, index) => {
    const source = requiredObject(rawSource, `costSources.${index}`);
    const id = String(source.id ?? '').trim();
    if (!id) {
      throw new Error(`costSources.${index}.id is required`);
    }
    const name = source.name == null ? undefined : String(source.name);
    if (source.type === 'fixed') {
      return {
        id,
        name,
        type: 'fixed',
        monthlyCostUsd: toNumber(source.monthlyCostUsd, `costSources.${index}.monthlyCostUsd`),
      };
    }
    if (source.type === 'variable') {
      const api = String(source.api ?? '').trim();
      if (!api) {
        throw new Error(`costSources.${index}.api is required for variable sources`);
      }
      return {
        id,
        name,
        type: 'variable',
        api,
        usageLevels: normalizeUsageLevels(source.usageLevels, id),
      };
    }
    throw new Error(`costSources.${index}.type must be fixed or variable`);
  });
};

const normalizeNumberRecord = (value: unknown, path: string): Record<string, number> => {
  const raw = requiredObject(value, path);
  return Object.fromEntries(Object.entries(raw).map(([key, rawValue]) => [key, toNumber(rawValue, `${path}.${key}`)]));
};

const normalizeUsagePerUser = (value: unknown): CostModelConfig['usagePerUser'] => {
  const raw = requiredObject(value, 'usagePerUser');
  return Object.fromEntries(
    Object.entries(raw).map(([userType, rawApiUsage]) => {
      const apiUsage = requiredObject(rawApiUsage, `usagePerUser.${userType}`);
      return [
        userType,
        Object.fromEntries(
          Object.entries(apiUsage).map(([api, rawUsage]) => [
            api,
            normalizeNumberRecord(rawUsage, `usagePerUser.${userType}.${api}`),
          ])
        ),
      ];
    })
  );
};

export const parseCostModelConfig = (rawConfig: unknown): CostModelConfig => {
  const root = requiredObject(rawConfig, 'config');
  const settings = requiredObject(root.settings, 'settings');
  const config: CostModelConfig = {
    settings: {
      rowStep: toPositiveInteger(settings.rowStep, 'settings.rowStep'),
      maxUsers: toPositiveInteger(settings.maxUsers, 'settings.maxUsers'),
    },
    userMix: normalizeNumberRecord(root.userMix, 'userMix'),
    usagePerUser: normalizeUsagePerUser(root.usagePerUser),
    costSources: normalizeCostSources(root.costSources),
  };

  const mixTotal = Object.values(config.userMix).reduce((sum, percentage) => sum + percentage, 0);
  if (Math.abs(mixTotal - 1) > 0.000001) {
    throw new Error(`userMix percentages must total 1. Current total: ${mixTotal}`);
  }
  for (const userType of Object.keys(config.userMix)) {
    if (!config.usagePerUser[userType]) {
      throw new Error(`usagePerUser.${userType} is required because userMix includes ${userType}`);
    }
  }
  return config;
};

export const loadCostModelConfig = (filePath: string): CostModelConfig => {
  const rawYaml = fs.readFileSync(filePath, 'utf8');
  return parseCostModelConfig(YAML.parse(rawYaml));
};

const addUsage = (left: UsageByMetric, right: UsageByMetric, multiplier: number): UsageByMetric => {
  const result = { ...left };
  for (const [metric, value] of Object.entries(right)) {
    result[metric] = (result[metric] ?? 0) + value * multiplier;
  }
  return result;
};

export const estimateBlendedUsageForApi = (config: CostModelConfig, api: string, users: number): UsageByMetric => {
  let usage: UsageByMetric = {};
  for (const [userType, percentage] of Object.entries(config.userMix)) {
    const userTypeUsage = config.usagePerUser[userType]?.[api] ?? {};
    usage = addUsage(usage, userTypeUsage, users * percentage);
  }
  return usage;
};

export const calculateCostRow = (config: CostModelConfig, users: number): CostModelRow => {
  const sourceCostsUsd: Record<string, number> = {};
  let fixedCostUsd = 0;
  let variableCostUsd = 0;

  for (const source of config.costSources) {
    if (source.type === 'fixed') {
      const cost = source.monthlyCostUsd;
      sourceCostsUsd[source.id] = cost;
      fixedCostUsd += cost;
      continue;
    }
    const usage = estimateBlendedUsageForApi(config, source.api, users);
    const cost = getApiCostCalculator(source.api)(source, usage);
    sourceCostsUsd[source.id] = cost;
    variableCostUsd += cost;
  }

  return {
    users,
    fixedCostUsd,
    variableCostUsd,
    totalCostUsd: fixedCostUsd + variableCostUsd,
    sourceCostsUsd,
  };
};

export const generateCostModelRows = (config: CostModelConfig): CostModelRow[] => {
  const rows: CostModelRow[] = [];
  for (let users = 0; users <= config.settings.maxUsers; users += config.settings.rowStep) {
    rows.push(calculateCostRow(config, users));
  }
  return rows;
};

const csvEscape = (value: string | number): string => {
  const raw = typeof value === 'number' ? value.toFixed(6).replace(/\.?0+$/, '') : value;
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
};

export const rowsToCsv = (rows: CostModelRow[], config: CostModelConfig): string => {
  const sourceIds = config.costSources.map((source) => source.id);
  const header = ['users', 'fixed_cost_usd', 'variable_cost_usd', 'total_cost_usd', ...sourceIds.map((id) => `${id}_usd`)];
  const lines = [
    header.map(csvEscape).join(','),
    ...rows.map((row) =>
      [
        row.users,
        row.fixedCostUsd,
        row.variableCostUsd,
        row.totalCostUsd,
        ...sourceIds.map((id) => row.sourceCostsUsd[id] ?? 0),
      ]
        .map(csvEscape)
        .join(',')
    ),
  ];
  return `${lines.join('\n')}\n`;
};

